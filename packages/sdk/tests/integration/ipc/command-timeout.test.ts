import type { OperationHandle } from "@edenapp/types";
import * as Effect from "effect/Effect";
import {
  command,
  defineController,
} from "../../../src/core/controllers/controller";
import { fromPromise } from "../../../src/core/effects/io";
import { testApp } from "../../support/apps";
import { createTestEden, type TestEden } from "../../support/create-test-eden";
import { promiseOperationTask } from "../../support/operations";

const appId = "com.example.command-deadlines";

describe("one bounded IPC deadline", () => {
  let eden: TestEden;
  let webContentsId: number;
  let complete!: (value: string) => void;
  let nativeSignal: AbortSignal | undefined;
  let nativeReleased: boolean;
  beforeEach(async () => {
    nativeSignal = undefined;
    nativeReleased = false;
    eden = await createTestEden();
    const user = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "operator",
        name: "Operator",
        password: "password",
        grants: ["*"],
      }),
    );
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(user.username, "password"),
    );
    eden.runtime.services.installedPackages.register(
      testApp(appId, { name: "Deadlines" }),
    );
    await eden.complete("process/launch", { appId });
    webContentsId = eden.getAppView(appId).view.webContents.id;
    const completion = new Promise<string>((resolve) => {
      complete = resolve;
    });
    eden.runtime.services.commands.registerController(
      defineController("deadline-test", {
        commands: {
          result: command({ handle: () => Effect.promise(() => completion) }),
          native: command({
            handle: () =>
              fromPromise((signal) => {
                nativeSignal = signal;
                return completion;
              }).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    nativeReleased = true;
                  }),
                ),
              ),
          }),
          failure: command({
            handle: () => Effect.fail(new TypeError("Command failed")),
          }),
          synchronousDefect: command({
            handle: () => {
              throw new TypeError("Command failed");
            },
          }),
          defect: command({
            handle: () => Effect.die(new TypeError("Command failed")),
          }),
          operation: command({
            mode: "operation",
            handle: () => promiseOperationTask(async () => completion),
          }),
        },
      }),
    );
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "setImmediate"] });
  });
  afterEach(async () => {
    complete("cleanup");
    jest.useRealTimers();
    await eden.dispose();
  });
  const invoke = (command: string) =>
    eden.platform.rendererIpc.invoke(
      "shell-command",
      webContentsId,
      `deadline-test/${command}`,
      {},
    );

  it("enforces ten seconds for result responses", async () => {
    let settled = false;
    const request = invoke("result").finally(() => {
      settled = true;
    });
    const rejection = expect(request).rejects.toThrow(
      "Command 'deadline-test/result' timed out",
    );
    await jest.advanceTimersByTimeAsync(9999);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await rejection;
  });

  it("accepts an operation within the deadline and leaves its execution unbounded", async () => {
    const response = (await invoke("operation")) as {
      mode: "operation";
      handle: OperationHandle;
    };
    const handle = response.handle;
    const commands = eden.runtime.services.operations;
    const caller = { appId };
    expect(commands.get(handle, caller).status).toBe("queued");
    await jest.advanceTimersByTimeAsync(120_000);
    expect(commands.get(handle, caller).status).toBe("running");
    complete("finished");
    await expect(
      eden.runtime.effects.run(commands.wait(handle, caller)),
    ).resolves.toBe("finished");
  });

  it("returns the deadline response while disposal waits for interrupted native cleanup", async () => {
    const request = invoke("native");
    const rejection = expect(request).rejects.toThrow(
      "Command 'deadline-test/native' timed out",
    );
    await jest.advanceTimersByTimeAsync(9999);
    expect(nativeSignal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await rejection;
    expect(nativeSignal?.aborted).toBe(true);

    jest.useRealTimers();
    let disposed = false;
    const disposal = eden.runtime.dispose().then(() => {
      disposed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(disposed).toBe(false);
    expect(nativeReleased).toBe(false);
    complete("cleanup");
    await disposal;
    expect(nativeReleased).toBe(true);
  });

  it.each(["failure", "defect", "synchronousDefect"])(
    "preserves the %s message and name without exposing its stack",
    async (command) => {
      await expect(invoke(command)).rejects.toMatchObject({
        message: "Command failed",
        name: "TypeError",
        stack: "",
      });
    },
  );

  it("rejects pending result responses when the runtime is disposed", async () => {
    const request = invoke("result");
    const rejection = expect(request).rejects.toThrow("Eden runtime disposed");
    jest.useRealTimers();
    await eden.runtime.dispose();
    await rejection;
  });
});
