import "reflect-metadata";
import type { OperationHandle, RuntimeAppManifest } from "@edenapp/types";
import { OperationManager } from "../operations/OperationManager";
import { type OperationTask, operationTask } from "../operations/OperationTask";
import { PackageRegistry } from "../package-manager/PackageRegistry";
import { ProcessManager } from "../process-manager/ProcessManager";
import { createTestEden, type TestEden } from "../testing/createTestEden";
import { ViewManager } from "../view-manager/ViewManager";
import { EdenHandler, EdenNamespace } from "./CommandDecorators";
import { CommandRegistry } from "./CommandRegistry";

class DeadlineFixture {
  constructor(private completion: Promise<string>) {}
  result(): Promise<string> {
    return this.completion;
  }
  operation(): OperationTask<string> {
    return operationTask(async () => this.completion);
  }
}
EdenNamespace("deadline-test")(DeadlineFixture);
for (const [method, mode] of [
  ["result", "result"],
  ["operation", "operation"],
] as const) {
  EdenHandler(method, { mode })(
    DeadlineFixture.prototype,
    method,
    Object.getOwnPropertyDescriptor(DeadlineFixture.prototype, method)!,
  );
}
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
    eden.runtime.resolve(PackageRegistry).register({
      kind: "app",
      id: appId,
      name: "Deadlines",
      version: "1.0.0",
      frontend: { entry: "index.html" },
      isPrebuilt: false,
      isDevelopment: false,
      isCore: false,
      isRestricted: false,
      resolvedGrants: [],
    } as RuntimeAppManifest);
    await eden.complete("process/launch", { appId });
    const instance = eden.runtime
      .resolve(ProcessManager)
      .getAppInstance(appId)!;
    webContentsId = eden.runtime
      .resolve(ViewManager)
      .getViewInfo(instance.viewId)!.view.webContents.id;
    const completion = new Promise<string>((resolve) => {
      complete = resolve;
    });
    eden.runtime
      .resolve(CommandRegistry)
      .registerManager(new DeadlineFixture(completion));
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
    const manager = eden.runtime.resolve(OperationManager);
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
