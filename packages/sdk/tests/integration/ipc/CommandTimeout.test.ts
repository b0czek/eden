import type { OperationHandle } from "@edenapp/types";
import { command, defineController } from "../../../src/controllers/controller";
import { CommandRegistry } from "../../../src/ipc/CommandRegistry";
import { OperationManager } from "../../../src/operations/OperationManager";
import {
  type OperationTask,
  operationTask,
} from "../../../src/operations/OperationTask";
import { PackageRegistry } from "../../../src/package-manager/PackageRegistry";
import { ProcessManager } from "../../../src/process-manager/ProcessManager";
import { ViewManager } from "../../../src/view-manager/ViewManager";
import { testApp } from "../../support/apps";
import { createTestEden, type TestEden } from "../../support/createTestEden";

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
    eden.runtime.services.packageRegistry.register(
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
          result: command({ handle: () => completion }),
          operation: command({
            mode: "operation",
            handle: () => operationTask(async () => completion),
          }),
        },
      }),
    );
    jest.useFakeTimers();
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
    const manager = eden.runtime.services.operations;
    const caller = { appId };
    expect(manager.get(handle, caller).status).toBe("queued");
    await jest.advanceTimersByTimeAsync(120_000);
    expect(manager.get(handle, caller).status).toBe("running");
    complete("finished");
    await expect(manager.wait(handle, caller)).resolves.toBe("finished");
  });

  it("rejects pending result responses when the runtime is disposed", async () => {
    const request = invoke("result");
    const rejection = expect(request).rejects.toThrow("Eden runtime disposed");
    jest.useRealTimers();
    await eden.runtime.dispose();
    await rejection;
  });
});
