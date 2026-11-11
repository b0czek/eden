import type { CommandName, StreamReader } from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as v from "valibot";
import { createEdenAPI } from "../../../src/app-runtime/common/eden-api";
import {
  command,
  defineController,
} from "../../../src/core/controllers/controller";
import {
  STREAM_ACK_BATCH,
  STREAM_CHANNEL,
  STREAM_WINDOW,
  type StreamMessage,
} from "../../../src/core/streams/protocol";
import { streamCapacityPerOwner } from "../../../src/core/streams/service";
import { testApp } from "../../support/apps";
import { gate, tick } from "../../support/async";
import { createTestCaller } from "../../support/callers";
import { createTestEden, type TestEden } from "../../support/create-test-eden";
import { connectViewStreams, readAll } from "../../support/streams";

type Reader = StreamReader<string>;

describe("stream commands", () => {
  const appId = "app.streams";
  let eden: TestEden;
  let webContentsId: number;
  let stopped: ReturnType<typeof gate<void>>;
  let unstuck: ReturnType<typeof gate<void>>;
  let sent: StreamMessage[];

  beforeEach(async () => {
    eden = await createTestEden();
    stopped = gate();
    unstuck = gate();
    sent = [];
    eden.runtime.services.installedPackages.register(testApp(appId));
    const { user } = await createTestCaller(eden, appId, ["feed/*"]);
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(user.username, "password"),
    );
    await eden.complete("process/launch", { appId });
    webContentsId = eden.getAppView(appId).view.webContents.id;
    eden.runtime.services.commands.registerController(
      defineController("feed", {
        commands: {
          numbers: command({
            mode: "stream",
            input: v.object({ count: v.number() }),
            handle: ({ count }) => Stream.range(1, count),
          }),
          endless: command({
            mode: "stream",
            handle: () =>
              Stream.iterate(1, (value) => value + 1).pipe(
                Stream.ensuring(Effect.sync(() => stopped.release())),
              ),
          }),
          idle: command({
            mode: "stream",
            handle: () =>
              Stream.never.pipe(
                Stream.ensuring(Effect.sync(() => stopped.release())),
              ),
          }),
          stuck: command({
            mode: "stream",
            handle: () =>
              Stream.fromEffect(
                Effect.uninterruptible(Effect.promise(() => unstuck.promise)),
              ),
          }),
          failing: command({
            mode: "stream",
            handle: () =>
              Stream.concat(
                Stream.make("first"),
                Stream.fail(new Error("Feed broke")),
              ),
          }),
        },
      }),
    );
  });

  afterEach(async () => {
    unstuck.release();
    await eden?.dispose();
  });

  function connectView() {
    const view = connectViewStreams(eden, appId);
    sent = view.sent;
    return view;
  }

  const chunksSent = () =>
    sent.filter((message) => message.kind === "chunk").length;

  it("delivers chunks in order beyond the credit window, then ends", async () => {
    const view = connectView();
    const reader = await view.open("feed/numbers", { count: 100 });
    expect(reader.handle).toEqual({
      command: "feed/numbers",
      id: expect.any(String),
    });
    await expect(readAll(reader)).resolves.toEqual(
      Array.from({ length: 100 }, (_, index) => index + 1),
    );
    await expect(reader.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it("sends no more than the window until the reader consumes chunks", async () => {
    const view = connectView();
    const reader = await view.open("feed/endless");
    await tick();
    expect(chunksSent()).toBe(STREAM_WINDOW);
    for (let index = 1; index < STREAM_ACK_BATCH; index++) await reader.next();
    await tick();
    expect(chunksSent()).toBe(STREAM_WINDOW);
    await reader.next();
    await tick();
    expect(chunksSent()).toBe(STREAM_WINDOW + STREAM_ACK_BATCH);
    await reader.cancel();
  });

  it("rejects with the stream failure after earlier chunks", async () => {
    const view = connectView();
    const reader = await view.open("feed/failing");
    await expect(reader.next()).resolves.toEqual({
      done: false,
      value: "first",
    });
    await expect(reader.next()).rejects.toThrow("Feed broke");
    await expect(reader.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it("cancels the source, finishes waiting reads, and releases the caller's capacity", async () => {
    const view = connectView();
    const reader = await view.open("feed/idle");
    const waiting = reader.next();
    await reader.cancel();
    await expect(waiting).resolves.toEqual({ done: true, value: undefined });
    await stopped.promise;
    await tick();
    expect(sent.at(-1)).toEqual({ id: reader.handle.id, kind: "end" });

    const readers = [];
    for (let index = 0; index < streamCapacityPerOwner; index++)
      readers.push(await view.open("feed/idle"));
    await expect(view.open("feed/idle")).rejects.toThrow(
      "Stream capacity exhausted",
    );
    await readers[0]?.cancel();
    await tick();
    await expect(view.open("feed/idle")).resolves.toBeDefined();
  });

  it("releases capacity on cancel before an uninterruptible source exits", async () => {
    const view = connectView();
    const readers = [];
    for (let index = 0; index < streamCapacityPerOwner; index++)
      readers.push(await view.open("feed/stuck"));
    await Promise.all(readers.map((reader) => reader.cancel()));
    await expect(view.open("feed/idle")).resolves.toBeDefined();
  });

  it("ignores acknowledgement and cancellation from other callers", async () => {
    const view = connectView();
    const reader = await view.open("feed/endless");
    await tick();
    const other = { webContentsId: webContentsId + 1000 };
    await eden.execute(
      "stream/ack",
      { handle: reader.handle, count: STREAM_WINDOW },
      other,
    );
    await eden.execute("stream/cancel", { handle: reader.handle }, other);
    await tick();
    expect(chunksSent()).toBe(STREAM_WINDOW);
    await expect(reader.next()).resolves.toEqual({ done: false, value: 1 });
    await reader.cancel();
  });

  it("stops a view's streams when the view closes", async () => {
    const view = connectView();
    await view.open("feed/idle");
    await eden.complete("process/stop", { appId });
    await stopped.promise;
  });

  it("stops a view's streams and frees its capacity when its page reloads", async () => {
    const previous = connectView();
    const readers = [];
    for (let index = 0; index < streamCapacityPerOwner; index++)
      readers.push(await previous.open("feed/idle"));
    const reloaded = connectView();
    await stopped.promise;
    await tick();
    expect(sent).toEqual([]);
    await expect(reloaded.open("feed/idle")).resolves.toBeDefined();
  });

  it("rejects stream commands from a page that was reloaded", async () => {
    const previous = connectView();
    const reloaded = connectView();
    await expect(previous.open("feed/idle")).rejects.toThrow("was reloaded");
    const current = await reloaded.open("feed/numbers", { count: 3 });
    await previous.transport.exec("stream/cancel", { handle: current.handle });
    await expect(readAll(current)).resolves.toEqual([1, 2, 3]);
  });

  it("requires an app view or backend caller", async () => {
    await expect(eden.execute("feed/numbers", { count: 1 })).rejects.toThrow(
      "requires an app view or backend caller",
    );
  });

  describe("from a backend", () => {
    const backendId = "app.streams-backend";
    let backendScope: Scope.Closeable;

    beforeEach(() => {
      backendScope = Scope.makeUnsafe();
    });

    afterEach(async () => {
      await eden.runtime.effects.run(Scope.close(backendScope, Exit.void));
    });

    async function connectBackend() {
      eden.runtime.services.runtimeContexts.register(backendId, {
        owner: {
          kind: "session",
          sessionId: eden.runtime.services.sessionContext.getSessionId(),
          username: null,
        },
        principal: { kind: "system" },
      });
      const starting = eden.runtime.effects.run(
        Scope.provide(
          eden.runtime.services.backends.createBackend(
            backendId,
            { ...testApp(backendId), backend: { entry: "backend.js" } },
            eden.paths.root,
          ),
          backendScope,
        ),
      );
      await tick();
      const process = eden.getBackendProcess(backendId);
      process.emit("message", { type: "backend-ready" });
      await starting;

      const pending = new Map<
        string,
        (response: { result?: unknown; error?: string }) => void
      >();
      let commandCount = 0;
      const { api, dispatchStream } = createEdenAPI({
        exec: (command, args) =>
          new Promise((resolve, reject) => {
            const commandId = `command-${commandCount++}`;
            pending.set(commandId, (response) =>
              response.error
                ? reject(new Error(response.error))
                : resolve(response.result as never),
            );
            process.emit("message", {
              type: "shell-command",
              commandId,
              command,
              args,
            });
          }),
      });
      const postMessage = process.postMessage.bind(process);
      process.postMessage = (message: unknown) => {
        postMessage(message);
        const received = message as {
          type: string;
          commandId?: string;
          result?: unknown;
          error?: string;
          message?: StreamMessage;
        };
        if (received.type === "shell-command-response" && received.commandId)
          pending.get(received.commandId)?.(received);
        else if (received.type === STREAM_CHANNEL && received.message)
          dispatchStream(received.message);
      };
      return {
        process,
        open: (name: string, args: unknown = {}) =>
          api.shellCommand(
            name as CommandName,
            args as never,
          ) as Promise<Reader>,
      };
    }

    it("delivers chunks over the backend message port", async () => {
      const backend = await connectBackend();
      const reader = await backend.open("feed/numbers", { count: 40 });
      await expect(readAll(reader)).resolves.toHaveLength(40);
    });

    it("stops a backend's streams when the backend exits", async () => {
      const backend = await connectBackend();
      await backend.open("feed/idle");
      backend.process.kill();
      await stopped.promise;
    });
  });
});
