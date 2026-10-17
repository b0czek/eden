import type { OperationHandle } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { command, defineController } from "../../../src/controllers/controller";
import { Commands } from "../../../src/ipc/commands";
import { Operations } from "../../../src/operations/service";
import type { OperationTask } from "../../../src/operations/task";
import { InstalledPackages } from "../../../src/packages/installed";
import { Processes } from "../../../src/processes/service";
import { Views } from "../../../src/views/service";
import { testApp } from "../../support/apps";
import { createTestEden, type TestEden } from "../../support/createTestEden";
import { promiseOperationTask } from "../../support/operations";

const appId = "com.example.command-deadlines";

describe("one bounded IPC deadline", () => {
  let eden: TestEden;
  let webContentsId: number;
  let complete!: (value: string) => void;
  beforeEach(async () => {
    eden = await createTestEden();
    const user = await eden.runtime.users.create({
      username: "operator",
      name: "Operator",
      password: "password",
      grants: ["*"],
    });
    await eden.runtime.sessions.login(user.username, "password");
    eden.runtime.services.installedPackages.register(
      testApp(appId, { name: "Deadlines" }),
    );
    await eden.complete("process/launch", { appId });
    const instance = eden.runtime.services.processes.getAppInstance(appId)!;
    webContentsId = eden.runtime.services.views.getViewInfo(instance.viewId)!
      .view.webContents.id;
    const completion = new Promise<string>((resolve) => {
      complete = resolve;
    });
    eden.runtime.services.commands.registerController(
      defineController("deadline-test", {
        commands: {
          result: command({ handle: () => Effect.promise(() => completion) }),
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

  it("rejects pending result responses when the runtime is disposed", async () => {
    const request = invoke("result");
    const rejection = expect(request).rejects.toThrow("Eden runtime disposed");
    jest.useRealTimers();
    await eden.runtime.dispose();
    await rejection;
  });
});
