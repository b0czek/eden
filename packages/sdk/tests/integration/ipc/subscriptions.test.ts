import * as fs from "node:fs/promises";
import * as path from "node:path";
import { volume as volumeClient } from "@edenapp/client";
import type {
  CommandArgs,
  CommandName,
  EdenAPI,
  OperationHandle,
  OperationSnapshot,
  OperationSubmission,
  UserProfile,
  WallpaperPreset,
} from "@edenapp/types";
import { createEdenAPI } from "../../../src/app-runtime/common/eden-api";
import {
  dispatchEvent,
  type EventSubscriptionCallback,
} from "../../../src/app-runtime/common/event-subscriptions";
import type {
  ShellCommandResponse,
  ShellTransport,
} from "../../../src/app-runtime/common/shell-transport";
import type { OperationReporter } from "../../../src/operations/task";
import { testApp } from "../../support/apps";
import { gate, tick } from "../../support/async";
import { createTestCaller } from "../../support/callers";
import { createTestEden, type TestEden } from "../../support/createTestEden";
import { promiseOperationTask } from "../../support/operations";

const _eventName = "volume/changed";

describe("client subscriptions across renderer IPC", () => {
  let eden: TestEden;
  const pendingWork = new Set<() => void>();
  const restoreRuntimes: Array<() => void> = [];
  let transport: ShellTransport;
  let listeners: Map<string, Set<EventSubscriptionCallback>>;
  let owner: {
    appId: string;
    principal: { kind: "user"; profile: UserProfile };
  };
  let webContentsId: number;
  beforeEach(async () => {
    eden = await createTestEden();
    const appId = "com.example.subscription-observer";
    eden.runtime.services.installedPackages.register(
      testApp(appId, { name: "Observer" }),
    );
    const { user: profile, caller } = await createTestCaller(
      eden,
      appId,
      ["volume/read"],
      { username: "observer", name: "Observer" },
    );
    owner = caller;
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(profile.username, "password"),
    );
    await eden.complete("process/launch", { appId });
    const contents = eden.getAppView(appId).view.webContents;
    webContentsId = contents.id;
    listeners = new Map();
    contents.on(
      "message-sent",
      (channel: string, message: { type: string; payload: unknown }) => {
        if (channel === "shell-message")
          dispatchEvent(listeners, message.type, message.payload);
      },
    );
    transport = {
      exec: <C extends CommandName>(
        command: C,
        args: CommandArgs<C>,
        submission?: OperationSubmission,
      ) =>
        eden.platform.rendererIpc.invoke(
          "shell-command",
          contents.id,
          command,
          args,
          submission,
        ) as Promise<ShellCommandResponse<C>>,
    };
  });
  afterEach(async () => {
    for (const finish of pendingWork) finish();
    pendingWork.clear();
    try {
      await eden?.dispose();
    } finally {
      for (const restore of restoreRuntimes.splice(0)) restore();
    }
  });

  const useClient = (api: EdenAPI, runtime: "window" | "worker" = "window") => {
    for (const key of ["window", "worker"]) {
      const original = Object.getOwnPropertyDescriptor(globalThis, key);
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value: key === runtime ? { edenAPI: api } : undefined,
      });
      restoreRuntimes.push(() => {
        if (original) Object.defineProperty(globalThis, key, original);
        else Reflect.deleteProperty(globalThis, key);
      });
    }
    return volumeClient;
  };
  const change = async (id: string) => {
    const rootPath = path.join(eden.paths.root, id);
    await fs.mkdir(rootPath);
    await eden.runtime.effects.run(
      eden.runtime.volumes.register({
        id,
        label: id,
        kind: "local",
        rootPath,
      }),
    );
  };

  function work(name: string) {
    const finish = gate();
    pendingWork.add(finish.release);
    const started = gate();
    let report!: OperationReporter;
    const handle = eden.runtime.services.operations.submit(
      "integration/observed-work",
      { name },
      owner,
      () =>
        promiseOperationTask(async (reporter) => {
          report = reporter;
          started.release();
          await finish.promise;
          await fs.writeFile(path.join(eden.paths.root, name), name);
          return name;
        }),
    );
    return {
      handle,
      started: started.promise,
      finish: finish.release,
      update: (phase: string) =>
        report.update(phase, { completed: 1, total: 2, unit: "files" }),
    };
  }
  const operationMessages = (handle: OperationHandle) =>
    eden.platform.effects.flatMap((effect) => {
      if (
        effect.type !== "message-sent" ||
        effect.webContentsId !== webContentsId ||
        effect.channel !== "shell-message"
      )
        return [];
      const message = effect.args[0] as {
        type: string;
        payload: { snapshot?: OperationSnapshot };
      };
      return message.type === "operation/changed" &&
        message.payload.snapshot?.id === handle.id
        ? [message.payload.snapshot]
        : [];
    });

  it("publishes localization events from a plain controller alongside legacy domains", async () => {
    const api = createEdenAPI(transport, listeners);
    const locales: string[] = [];
    const onLocale = ({ locale }: { locale: string }) => {
      locales.push(locale);
    };
    await api.subscribe("i18n/locale-changed", onLocale);
    await eden.runtime.effects.run(
      eden.runtime.services.settings.set("com.eden", "general.locale", "pl"),
    );
    expect(locales).toEqual(["pl"]);
    await expect(api.shellCommand("i18n/get-locale", {})).resolves.toEqual({
      locale: "pl",
    });
    const common = await api.shellCommand("i18n/get-common", { locale: "pl" });
    expect(common.translations).toMatchObject({ common: { cancel: "Anuluj" } });
    api.unsubscribe("i18n/locale-changed", onLocale);
  });

  it("validates and authorizes plain appearance commands and publishes their resolved events", async () => {
    const api = createEdenAPI(transport, listeners);
    const wallpaper = { type: "custom" as const, value: "#123456" };
    await expect(
      api.shellCommand("appearance/set-wallpaper", { wallpaper }),
    ).rejects.toThrow("Permission denied");
    eden.runtime.services.permissions.registerApp(owner.appId, [
      "appearance/manage",
    ]);
    const external: WallpaperPreset[] = [];
    const local: WallpaperPreset[] = [];
    const stop = eden.runtime.appearance.onChanged((value) => {
      local.push(value);
    });
    const listener = (value: WallpaperPreset) => {
      external.push(value);
    };
    await api.subscribe("appearance/wallpaper-changed", listener);
    await api.shellCommand("appearance/set-wallpaper", { wallpaper });
    const expected = {
      id: "custom",
      name: "Custom",
      type: "custom",
      value: "#123456",
    };
    expect(external).toEqual([expected]);
    expect(local).toEqual([expected]);
    await expect(
      api.shellCommand("appearance/get-wallpaper", {}),
    ).resolves.toEqual({ wallpaper: expected });
    await expect(
      eden.execute(
        "appearance/set-wallpaper",
        { wallpaper: { type: "invalid" } },
        owner,
      ),
    ).rejects.toThrow();
    expect(
      await eden.runtime.effects.run(eden.runtime.appearance.getWallpaper()),
    ).toEqual(expected);
    api.unsubscribe("appearance/wallpaper-changed", listener);
    stop();
  });

  it.each([false, true])(
    "preserves a replacement listener after an older request fails (same callback: %s)",
    async (sameCallback) => {
      const started = gate();
      const finish = gate();
      let first = true;
      const api = createEdenAPI(
        {
          exec: async (command, args, submission) => {
            if (command === "event/subscribe" && first) {
              first = false;
              started.release();
              await finish.promise;
              throw new Error("First registration failed");
            }
            return transport.exec(command, args, submission);
          },
        },
        listeners,
      );
      const updates: string[] = [];
      const client = useClient(api);
      const replacement = () => {
        updates.push("delivered");
      };
      const original = sameCallback ? replacement : () => undefined;
      const initial = client.subscribe("changed", original);
      const failure = expect(initial).rejects.toThrow(
        "First registration failed",
      );
      await started.promise;
      client.unsubscribe("changed", original);
      const accepted = client.subscribe("changed", replacement);
      finish.release();
      await failure;
      await accepted;
      await change("replacement");
      expect(updates).toEqual(["delivered"]);
      client.unsubscribe("changed", replacement);
      await tick();
    },
  );

  it.each(["window", "worker"] as const)(
    "keeps the remaining %s client listener active when another stops",
    async (runtime) => {
      const api = createEdenAPI(transport, listeners);
      const client = useClient(api, runtime);
      const first: string[] = [];
      const second: string[] = [];
      const one = () => {
        first.push("changed");
      };
      const two = () => {
        second.push("changed");
      };
      await Promise.all([
        client.subscribe("changed", one),
        client.subscribe("changed", two),
      ]);
      client.unsubscribe("changed", one);
      await tick();
      await change("still-observed");
      expect(first).toEqual([]);
      expect(second).toEqual(["changed"]);
      client.unsubscribe("changed", two);
      await tick();
      await change("unobserved");
      expect(second).toEqual(["changed"]);
    },
  );

  it("stops a client listener immediately while remote setup is pending", async () => {
    const started = gate();
    const finish = gate();
    pendingWork.add(finish.release);
    let first = true;
    const client = useClient(
      createEdenAPI(
        {
          exec: async (command, args, submission) => {
            const response = await transport.exec(command, args, submission);
            if (command === "event/subscribe" && first) {
              first = false;
              started.release();
              await finish.promise;
            }
            return response;
          },
        },
        listeners,
      ),
    );
    const updates: string[][] = [];
    const callback = (event: { volumes: Array<{ id: string }> }) => {
      updates.push(event.volumes.map((volume) => volume.id));
    };
    const ready = client.subscribe("changed", callback);
    await started.promise;
    client.unsubscribe("changed", callback);
    await change("during-setup");
    expect(updates).toEqual([]);
    finish.release();
    await ready;
    await tick();
    await change("after-setup");
    expect(updates).toEqual([]);
    await client.subscribe("changed", callback);
    await change("resubscribed");
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain("resubscribed");
    client.unsubscribe("changed", callback);
    await tick();
  });

  it("isolates async listener failures and failed remote cleanup", async () => {
    const api = createEdenAPI(
      {
        exec: (command, args, submission) =>
          command === "event/unsubscribe"
            ? Promise.reject(new Error("Cleanup transport closed"))
            : transport.exec(command, args, submission),
      },
      listeners,
    );
    const broken = async () => {
      throw new Error("Listener failed asynchronously");
    };
    let delivered = 0;
    const client = useClient(api);
    const healthy = () => {
      delivered++;
    };
    await client.subscribe("changed", broken);
    await client.subscribe("changed", healthy);
    await change("listeners");
    await tick();
    expect(delivered).toBe(1);
    client.unsubscribe("changed", broken);
    client.unsubscribe("changed", healthy);
    await tick();
    await change("stopped");
    expect(delivered).toBe(1);
    await client.subscribe("changed", healthy);
    await change("reopened");
    expect(delivered).toBe(2);
    client.unsubscribe("changed", healthy);
    await tick();
  });

  it.each(["sync", "async"])(
    "isolates %s operation-watch failures for initial and subsequent snapshots",
    async (kind) => {
      const api = createEdenAPI(transport, listeners);
      const operation = work(`watch-failure-${kind}`);
      await operation.started;
      const broken: number[] = [];
      const healthy: number[] = [];
      const fail = (snapshot: OperationSnapshot) => {
        broken.push(snapshot.revision);
        throw new Error("Operation listener failed");
      };
      const stopBroken = await api.operations
        .from(operation.handle)
        .watch(kind === "async" ? async (snapshot) => fail(snapshot) : fail);
      const stopHealthy = await api.operations
        .from(operation.handle)
        .watch((snapshot) => {
          healthy.push(snapshot.revision);
        });
      try {
        await tick();
        expect(broken).toEqual(healthy);
        expect(healthy).toHaveLength(1);
        operation.update("copying");
        await tick();
        expect(broken).toEqual(healthy);
        expect(healthy).toHaveLength(2);
        const completion = api.operations.from(operation.handle).result();
        operation.finish();
        await expect(completion).resolves.toBe(`watch-failure-${kind}`);
        await tick();
        expect(broken).toEqual(healthy);
        expect(healthy).toHaveLength(3);
      } finally {
        stopBroken();
        stopHealthy();
        operation.finish();
      }
    },
  );

  it("routes by operation and delivers only completion to waiters", async () => {
    const api = createEdenAPI(transport, listeners);
    const operations = eden.runtime.services.operations;
    const watched = work("watched");
    const waited = work("waited");
    const ignored = work("ignored");
    await Promise.all([watched.started, waited.started, ignored.started]);
    const first: OperationSnapshot[] = [];
    const second: OperationSnapshot[] = [];
    const stopFirst = await api.operations
      .from(watched.handle)
      .watch((snapshot) => {
        first.push(snapshot);
      });
    const stopSecond = await api.operations
      .from(watched.handle)
      .watch((snapshot) => {
        second.push(snapshot);
      });
    const completion = api.operations.from(waited.handle).result();
    await tick();
    const initialRevision = operations.get(watched.handle, owner).revision;
    watched.update("copying");
    watched.update("copying");
    expect(operations.get(watched.handle, owner).revision).toBeGreaterThan(
      initialRevision,
    );
    expect(
      first.filter((snapshot) => snapshot.phase === "copying"),
    ).toHaveLength(1);
    expect(
      second.filter((snapshot) => snapshot.phase === "copying"),
    ).toHaveLength(1);
    expect(
      operationMessages(watched.handle).filter(
        (snapshot) => snapshot.phase === "copying",
      ),
    ).toHaveLength(1);
    waited.update("copying");
    ignored.update("copying");
    expect(operationMessages(waited.handle)).toEqual([]);
    expect(operationMessages(ignored.handle)).toEqual([]);
    expect(operations.get(ignored.handle, owner).phase).toBe("copying");
    stopFirst();
    await tick();
    watched.update("finishing");
    expect(first.some((snapshot) => snapshot.phase === "finishing")).toBe(
      false,
    );
    expect(second.some((snapshot) => snapshot.phase === "finishing")).toBe(
      true,
    );
    waited.finish();
    await expect(completion).resolves.toBe("waited");
    expect(
      operationMessages(waited.handle).map((snapshot) => snapshot.status),
    ).toEqual(["succeeded"]);
    expect(
      await fs.readFile(path.join(eden.paths.root, "waited"), "utf8"),
    ).toBe("waited");
    watched.finish();
    ignored.finish();
    await Promise.all([
      eden.runtime.effects.run(operations.wait(watched.handle, owner)),
      eden.runtime.effects.run(operations.wait(ignored.handle, owner)),
    ]);
    stopSecond();
    await tick();
    await expect(api.operations.from(ignored.handle).result()).resolves.toBe(
      "ignored",
    );
  });

  it("returns bound operation controls and restores them from a retained handle", async () => {
    eden.runtime.services.permissions.registerApp(owner.appId, [
      "fs/read",
      "fs/write",
    ]);
    await fs.writeFile(
      path.join(eden.paths.userDirectory, "source.txt"),
      "copied",
    );
    const api = createEdenAPI(transport, listeners);
    const info = await api.shellCommand("system/info", {});
    expect(info.runningApps).toContain(owner.appId);
    const args = {
      from: { volume: "home", path: "/source.txt" },
      to: { volume: "home", path: "/destination.txt" },
    };
    const copy = await api.shellCommand("fs/cp", args, { requestKey: "copy" });
    const repeated = await api.shellCommand("fs/cp", args, {
      requestKey: "copy",
    });
    expect(repeated.handle).toEqual(copy.handle);
    await eden.runtime.effects.run(eden.runtime.services.operations.drain());
    await expect(copy.result()).resolves.toBeUndefined();
    expect(
      await fs.readFile(
        path.join(eden.paths.userDirectory, "destination.txt"),
        "utf8",
      ),
    ).toBe("copied");
    const restored = api.operations.from(
      JSON.parse(JSON.stringify(copy.handle)) as OperationHandle<"fs/cp">,
    );
    await expect(restored.result()).resolves.toBeUndefined();
    expect(await restored.get()).toMatchObject({ status: "succeeded" });
    const snapshots: OperationSnapshot[] = [];
    const stop = await restored.watch((snapshot) => snapshots.push(snapshot));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].status).toBe("succeeded");
    stop();
  });

  it("cancels a recursive copy through the client API and delivers its terminal cleanup status", async () => {
    eden.runtime.services.permissions.registerApp(owner.appId, [
      "fs/read",
      "fs/write",
    ]);
    const source = path.join(eden.paths.userDirectory, "cancel-tree");
    const destination = path.join(eden.paths.userDirectory, "cancel-tree-copy");
    await fs.mkdir(path.join(source, "nested"), { recursive: true });
    await fs.writeFile(
      path.join(source, "nested", "large.bin"),
      Buffer.alloc(8 * 1024 * 1024),
    );
    const api = createEdenAPI(transport, listeners);
    const copy = await api.shellCommand("fs/cp", {
      from: { volume: "home", path: "/cancel-tree" },
      to: { volume: "home", path: "/cancel-tree-copy" },
    });
    const completion = expect(copy.result()).rejects.toMatchObject({
      name: "AbortError",
    });
    const snapshots: OperationSnapshot[] = [];
    let cancellation: Promise<void> | undefined;
    const stop = await copy.watch((snapshot) => {
      snapshots.push(snapshot);
      if (
        !cancellation &&
        snapshot.phase === "copying" &&
        snapshot.progress !== undefined &&
        snapshot.progress.completed > 0
      ) {
        cancellation = copy.cancel();
      }
    });
    try {
      await completion;
      await cancellation;
      expect(snapshots.at(-1)?.status).toBe("cancelled");
      expect(
        snapshots.some((snapshot) => snapshot.phase === "rolling-back"),
      ).toBe(true);
      expect(await copy.get()).toMatchObject({
        status: "cancelled",
      });
      // Reconciliation must settle the result even when cancellation predates observation.
      await expect(copy.result()).rejects.toMatchObject({
        name: "AbortError",
      });
      await expect(fs.access(destination)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(
        (await fs.stat(path.join(source, "nested", "large.bin"))).size,
      ).toBe(8 * 1024 * 1024);
      await eden.runtime.effects.run(eden.runtime.services.operations.drain());
    } finally {
      stop();
    }
  });

  it("keeps broad and targeted observers independent and rejects foreign handles", async () => {
    const api = createEdenAPI(transport, listeners);
    const watched = work("shared-interest");
    await watched.started;
    const broad: OperationSnapshot[] = [];
    const callback = ({ snapshot }: { snapshot: OperationSnapshot }) => {
      broad.push(snapshot);
    };
    await api.subscribe("operation/changed", callback);
    const targeted: OperationSnapshot[] = [];
    const stop = await api.operations.from(watched.handle).watch((snapshot) => {
      targeted.push(snapshot);
    });
    watched.update("copying");
    expect(
      broad.filter((snapshot) => snapshot.phase === "copying"),
    ).toHaveLength(1);
    expect(
      targeted.filter((snapshot) => snapshot.phase === "copying"),
    ).toHaveLength(1);
    expect(
      operationMessages(watched.handle).filter(
        (snapshot) => snapshot.phase === "copying",
      ),
    ).toHaveLength(1);
    api.unsubscribe("operation/changed", callback);
    await tick();
    watched.update("finishing");
    expect(broad.some((snapshot) => snapshot.phase === "finishing")).toBe(
      false,
    );
    expect(targeted.some((snapshot) => snapshot.phase === "finishing")).toBe(
      true,
    );
    const operations = eden.runtime.services.operations;
    const foreign = operations.submit(
      "integration/foreign",
      {},
      { ...owner, appId: "another.app" },
      () => promiseOperationTask(async () => "private"),
    );
    await expect(
      api.operations.from(foreign).watch(() => undefined),
    ).rejects.toThrow("access denied");
    await expect(
      api.shellCommand("event/subscribe", {
        eventName: "operation/changed",
        operation: { handle: { ...watched.handle, command: "wrong" } },
      }),
    ).rejects.toThrow("access denied");
    watched.finish();
    await eden.runtime.effects.run(operations.wait(watched.handle, owner));
    stop();
    await tick();
  });
});
