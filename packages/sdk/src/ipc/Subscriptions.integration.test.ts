import type {
  ShellCommandResponse,
  ShellTransport,
} from "../app-runtime/common/shell-transport";
import "reflect-metadata";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  CommandArgs,
  CommandName,
  OperationHandle,
  OperationSnapshot,
  OperationSubmission,
  RuntimeAppManifest,
  UserProfile,
} from "@edenapp/types";
import { createEdenAPI } from "../app-runtime/common/eden-api";
import {
  dispatchEvent,
  type EventSubscriptionCallback,
} from "../app-runtime/common/event-subscriptions";
import { OperationManager } from "../operations/OperationManager";
import {
  type OperationReporter,
  operationTask,
} from "../operations/OperationTask";
import { PackageRegistry } from "../package-manager/PackageRegistry";
import { ProcessManager } from "../process-manager/ProcessManager";
import { createTestEden, type TestEden } from "../testing/createTestEden";
import { ViewManager } from "../view-manager/ViewManager";
import { EdenNamespace } from "./CommandDecorators";
import { EdenEmitter } from "./EdenEmitter";
import { IPCBridge } from "./IPCBridge";
import { PermissionRegistry } from "./PermissionRegistry";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const eventName = "fs/volumes-changed";
function gate() {
  let release!: () => void;
  return {
    promise: new Promise<void>((resolve) => {
      release = resolve;
    }),
    release: () => release(),
  };
}

describe("client subscriptions across renderer IPC", () => {
  let eden: TestEden;
  const pendingWork = new Set<() => void>();
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
    eden.runtime.resolve(PackageRegistry).register({
      kind: "app",
      id: appId,
      name: "Observer",
      version: "1.0.0",
      frontend: { entry: "index.html" },
      isPrebuilt: false,
      isDevelopment: false,
      isCore: false,
      isRestricted: false,
      resolvedGrants: [],
    } as RuntimeAppManifest);
    eden.runtime.resolve(PermissionRegistry).registerApp(appId, ["fs/read"]);
    const profile = await eden.runtime.users.create({
      username: "observer",
      name: "Observer",
      password: "password",
      grants: ["*"],
    });
    owner = { appId, principal: { kind: "user", profile } };
    await eden.runtime.sessions.login("observer", "password");
    await eden.complete("process/launch", { appId });
    const instance = eden.runtime
      .resolve(ProcessManager)
      .getAppInstance(appId)!;
    const contents = eden.runtime
      .resolve(ViewManager)
      .getViewInfo(instance.viewId)!.view.webContents;
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
    await eden?.dispose();
  });
  const change = async (id: string) => {
    const rootPath = path.join(eden.paths.root, id);
    await fs.mkdir(rootPath);
    await eden.runtime.volumes.register({
      id,
      label: id,
      kind: "local",
      rootPath,
    });
  };

  function work(name: string) {
    const finish = gate();
    pendingWork.add(finish.release);
    const started = gate();
    let report!: OperationReporter;
    const handle = eden.runtime
      .resolve(OperationManager)
      .submit("integration/observed-work", { name }, owner, () =>
        operationTask(async (reporter) => {
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
      const replacement = () => {
        updates.push("delivered");
      };
      const original = sameCallback ? replacement : () => undefined;
      const initial = api.subscribe(eventName, original);
      const failure = expect(initial).rejects.toThrow(
        "First registration failed",
      );
      await started.promise;
      api.unsubscribe(eventName, original);
      const accepted = api.subscribe(eventName, replacement);
      finish.release();
      await failure;
      await accepted;
      await change("replacement");
      expect(updates).toEqual(["delivered"]);
      api.unsubscribe(eventName, replacement);
      await tick();
    },
  );

  it("keeps the remaining listener active when another stops", async () => {
    const api = createEdenAPI(transport, listeners);
    const first: string[] = [];
    const second: string[] = [];
    const one = () => {
      first.push("changed");
    };
    const two = () => {
      second.push("changed");
    };
    await Promise.all([
      api.subscribe(eventName, one),
      api.subscribe(eventName, two),
    ]);
    api.unsubscribe(eventName, one);
    await tick();
    await change("still-observed");
    expect(first).toEqual([]);
    expect(second).toEqual(["changed"]);
    api.unsubscribe(eventName, two);
    await tick();
    await change("unobserved");
    expect(second).toEqual(["changed"]);
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
    const healthy = () => {
      delivered++;
    };
    await api.subscribe(eventName, broken);
    await api.subscribe(eventName, healthy);
    await change("listeners");
    await tick();
    expect(delivered).toBe(1);
    api.unsubscribe(eventName, broken);
    api.unsubscribe(eventName, healthy);
    await tick();
    await change("stopped");
    expect(delivered).toBe(1);
    await api.subscribe(eventName, healthy);
    await change("reopened");
    expect(delivered).toBe(2);
    api.unsubscribe(eventName, healthy);
    await tick();
  });

  it.each(["sync", "async"])(
    "isolates %s operation-watch failures for initial and subsequent snapshots",
    async (kind) => {
      const api = createEdenAPI(transport, listeners);
      const operation = work("watch-failure-" + kind);
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
        await expect(completion).resolves.toBe("watch-failure-" + kind);
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
    const manager = eden.runtime.resolve(OperationManager);
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
    const initialRevision = manager.get(watched.handle, owner).revision;
    watched.update("copying");
    watched.update("copying");
    expect(manager.get(watched.handle, owner).revision).toBeGreaterThan(
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
    expect(manager.get(ignored.handle, owner).phase).toBe("copying");
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
      manager.wait(watched.handle, owner),
      manager.wait(ignored.handle, owner),
    ]);
    stopSecond();
    await tick();
    await expect(api.operations.from(ignored.handle).result()).resolves.toBe(
      "ignored",
    );
  });

  it("returns bound operation controls and restores them from a retained handle", async () => {
    eden.runtime
      .resolve(PermissionRegistry)
      .registerApp(owner.appId, ["fs/read", "fs/write"]);
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
    await eden.runtime.resolve(OperationManager).drain();
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
    eden.runtime
      .resolve(PermissionRegistry)
      .registerApp(owner.appId, ["fs/read", "fs/write"]);
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
        snapshot.progress!.completed > 0
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
      await eden.runtime.resolve(OperationManager).drain();
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
    const manager = eden.runtime.resolve(OperationManager);
    const foreign = manager.submit(
      "integration/foreign",
      {},
      { ...owner, appId: "another.app" },
      () => operationTask(async () => "private"),
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
    await manager.wait(watched.handle, owner);
    stop();
    await tick();
  });

  it("builds lazy notification payloads only when local or external observers exist", async () => {
    class Producer extends EdenEmitter<{ "volumes-changed": { volumes: [] } }> {
      publish(payload: () => { volumes: [] }) {
        this.notify("volumes-changed", payload);
      }
    }
    EdenNamespace("fs")(Producer);
    const producer = new Producer(eden.runtime.resolve(IPCBridge));
    expect(() =>
      producer.publish(() => {
        throw new Error("Payload should not be built");
      }),
    ).not.toThrow();
    const local: unknown[] = [];
    const off = producer.on("volumes-changed", (payload) => {
      local.push(payload);
    });
    producer.publish(() => ({ volumes: [] }));
    expect(local).toEqual([{ volumes: [] }]);
    off();
    const api = createEdenAPI(transport, listeners);
    const external: unknown[] = [];
    const callback = (payload: unknown) => {
      external.push(payload);
    };
    await api.subscribe(eventName, callback);
    producer.publish(() => ({ volumes: [] }));
    expect(external).toEqual([{ volumes: [] }]);
    api.unsubscribe(eventName, callback);
    await tick();
    expect(() =>
      producer.publish(() => {
        throw new Error("Payload should no longer be built");
      }),
    ).not.toThrow();
    producer.dispose();
  });
});
