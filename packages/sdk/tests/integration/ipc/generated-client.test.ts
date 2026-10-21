import * as nodeFs from "node:fs/promises";
import * as path from "node:path";
import * as client from "@edenapp/client";
import type {
  CommandArgs,
  CommandName,
  OperationSnapshot,
  OperationSubmission,
} from "@edenapp/types";
import { createEdenAPI } from "../../../src/app-runtime/common/eden-api";
import {
  dispatchEvent,
  type EventSubscriptionCallback,
} from "../../../src/app-runtime/common/event-subscriptions";
import type { ShellCommandResponse } from "../../../src/app-runtime/common/shell-transport";
import { testApp } from "../../support/apps";
import { createTestCaller } from "../../support/callers";
import { createTestEden, type TestEden } from "../../support/create-test-eden";

describe.each(["window", "worker"])(
  "generated %s client over production shell IPC",
  (globalName) => {
    let eden: TestEden;
    let original: PropertyDescriptor | undefined;
    const appId = "com.example.generated-client";

    beforeEach(async () => {
      original = Object.getOwnPropertyDescriptor(globalThis, globalName);
      eden = await createTestEden();
      eden.runtime.services.installedPackages.register(
        testApp(appId, {
          name: "Generated Client",
          window: {
            mode: "floating",
            injections: { appFrame: "none", css: "none" },
          },
        }),
      );
      await createTestCaller(eden, appId, ["fs/read", "fs/write", "db/rw"], {
        username: "client",
        name: "Client",
      });
      await eden.runtime.effects.run(
        eden.runtime.sessions.login("client", "password"),
      );
      await eden.complete("process/launch", { appId });
      const contents = eden.getAppView(appId).view.webContents;
      const listeners = new Map<string, Set<EventSubscriptionCallback>>();
      contents.on(
        "message-sent",
        (channel: string, message: { type: string; payload: unknown }) => {
          if (channel === "shell-message")
            dispatchEvent(listeners, message.type, message.payload);
        },
      );
      const api = createEdenAPI(
        {
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
        },
        listeners,
      );
      Object.defineProperty(globalThis, globalName, {
        configurable: true,
        value: { edenAPI: api },
      });
    });

    afterEach(async () => {
      if (original) Object.defineProperty(globalThis, globalName, original);
      else Reflect.deleteProperty(globalThis, globalName);
      await eden?.dispose();
    });

    it("executes positional, optional, binary, and empty-argument commands with real effects", async () => {
      expect(await client.fs.accessScope("home")).toEqual({
        volume: "home",
        path: "/",
      });
      const location = { volume: "home", path: "/client.txt" };
      await client.fs.write(location, "hello", { encoding: "utf8" });
      expect(await client.fs.read(location)).toBe("hello");
      expect(await client.fs.stat(location)).toMatchObject({
        isFile: true,
        size: 5,
      });
      expect(
        await nodeFs.readFile(
          path.join(eden.paths.userDirectory, "client.txt"),
          "utf8",
        ),
      ).toBe("hello");
      await client.fs.writeBinary(location, new Uint8Array([0, 255, 128]));
      expect(await client.fs.readBinary(location)).toEqual(
        new Uint8Array([0, 255, 128]),
      );
      const handle = await client.fs.open(location, { mode: "read" });
      try {
        expect(await client.fs.stat(handle)).toMatchObject({
          isFile: true,
          size: 3,
        });
        expect(await client.fs.readBinary(handle)).toEqual(
          new Uint8Array([0, 255, 128]),
        );
      } finally {
        await client.fs.close(handle);
      }
      await client.db.set("theme", "dark");
      expect(await client.db.get("theme")).toEqual({ value: "dark" });
      expect(await client.db.list()).toEqual({ keys: ["theme"] });
    });

    it("sets an association using key, app ID, kind and optional label arguments", async () => {
      await client.associations.set(
        "provider:generated",
        "com.example.provider",
        "provider",
        { label: "Generated provider" },
      );
      expect(await client.associations.get("provider:generated")).toEqual({
        association: {
          appId: "com.example.provider",
          kind: "provider",
          label: "Generated provider",
        },
      });
    });

    it("preserves operation completion, observation, overwrite options, and submission deduplication", async () => {
      const from = { volume: "home", path: "/source.txt" };
      const to = { volume: "home", path: "/destination.txt" };
      await client.fs.write(from, "copied");
      await client.fs.write(to, "old contents");
      const options = { overwrite: true, submission: { requestKey: "copy" } };
      const copy = await client.fs.cp(from, to, options);
      const repeated = await client.fs.cp(from, to, options);
      expect(repeated.handle).toEqual(copy.handle);
      await expect(copy.result()).resolves.toBeUndefined();
      expect(await client.fs.read(to)).toBe("copied");
      expect(await copy.get()).toMatchObject({ status: "succeeded" });
      const snapshots: OperationSnapshot[] = [];
      const stop = await copy.watch((snapshot) => snapshots.push(snapshot));
      expect(snapshots.at(-1)?.status).toBe("succeeded");
      stop();
    });

    it("propagates permission and validation failures", async () => {
      eden.runtime.services.permissions.registerApp(appId, ["fs/read"]);
      await expect(
        client.fs.write({ volume: "home", path: "/forbidden.txt" }, "denied"),
      ).rejects.toThrow(/permission/i);
      await expect(
        client.fs.stat({ volume: "missing", path: "/" }),
      ).rejects.toThrow();
    });
  },
);
