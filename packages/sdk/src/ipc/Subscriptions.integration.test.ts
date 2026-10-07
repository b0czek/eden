import type { ShellTransport } from "../app-runtime/common/shell-transport";
import "reflect-metadata";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  CommandArgs,
  CommandName,
  CommandResult,
  RuntimeAppManifest,
} from "@edenapp/types";
import { createEdenAPI } from "../app-runtime/common/eden-api";
import {
  dispatchEvent,
  type EventSubscriptionCallback,
} from "../app-runtime/common/event-subscriptions";
import { PackageRegistry } from "../package-manager/PackageRegistry";
import { ProcessManager } from "../process-manager/ProcessManager";
import { ViewManager } from "../view-manager/ViewManager";
import { createTestEden, type TestEden } from "../testing/createTestEden";
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
  let transport: ShellTransport;
  let listeners: Map<string, Set<EventSubscriptionCallback>>;
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
    await eden.runtime.users.create({
      username: "observer",
      name: "Observer",
      password: "password",
      grants: ["*"],
    });
    await eden.runtime.sessions.login("observer", "password");
    await eden.complete("process/launch", { appId });
    const instance = eden.runtime
      .resolve(ProcessManager)
      .getAppInstance(appId)!;
    const contents = eden.runtime
      .resolve(ViewManager)
      .getViewInfo(instance.viewId)!.view.webContents;
    listeners = new Map();
    contents.on(
      "message-sent",
      (channel: string, message: { type: string; payload: unknown }) => {
        if (channel === "shell-message")
          dispatchEvent(listeners, message.type, message.payload);
      },
    );
    transport = {
      exec: <C extends CommandName>(command: C, args: CommandArgs<C>) =>
        eden.platform.rendererIpc.invoke(
          "shell-command",
          contents.id,
          command,
          args,
        ) as Promise<CommandResult<C>>,
    };
  });
  afterEach(async () => {
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
});
