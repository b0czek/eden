import { createIdleProcessStopper } from "./IdleProcessStopper";

type ProcessManagerMock = jest.Mocked<
  Parameters<typeof createIdleProcessStopper>[0]
>;

const createProcessManager = (): ProcessManagerMock => ({
  getAppInstance: jest.fn((_appId: string) => ({}) as never),
  stopApp: jest.fn(async (_appId: string) => undefined),
});

describe("IdleProcessStopper", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("schedules the current target after delay", async () => {
    const processManager = createProcessManager();
    const stopper = createIdleProcessStopper(processManager, 1000, "test app");

    stopper.setTarget("com.example.app");
    stopper.schedule();
    jest.advanceTimersByTime(999);
    expect(processManager.stopApp).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    await Promise.resolve();

    expect(processManager.stopApp).toHaveBeenCalledWith("com.example.app");
  });

  it("schedule with no target does nothing", () => {
    const processManager = createProcessManager();
    const stopper = createIdleProcessStopper(processManager, 1000);

    stopper.schedule();
    jest.advanceTimersByTime(1000);

    expect(processManager.stopApp).not.toHaveBeenCalled();
  });

  it("cancel prevents the scheduled stop", () => {
    const processManager = createProcessManager();
    const stopper = createIdleProcessStopper(processManager, 1000);

    stopper.setTarget("com.example.app");
    stopper.schedule();
    stopper.cancel();
    jest.advanceTimersByTime(1000);

    expect(processManager.stopApp).not.toHaveBeenCalled();
  });

  it("changing target before the timer fires stops only the latest target", async () => {
    const processManager = createProcessManager();
    const stopper = createIdleProcessStopper(processManager, 1000);

    stopper.setTarget("com.example.first");
    stopper.schedule();
    jest.advanceTimersByTime(500);
    stopper.setTarget("com.example.second");
    stopper.schedule();
    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(processManager.stopApp).toHaveBeenCalledTimes(1);
    expect(processManager.stopApp).toHaveBeenCalledWith("com.example.second");
  });

  it("clearTarget only clears the matching target", async () => {
    const processManager = createProcessManager();
    const stopper = createIdleProcessStopper(processManager, 1000);

    stopper.setTarget("com.example.app");
    stopper.clearTarget("com.example.other");
    stopper.schedule();
    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(processManager.stopApp).toHaveBeenCalledWith("com.example.app");

    processManager.stopApp.mockClear();
    stopper.setTarget("com.example.app");
    stopper.clearTarget("com.example.app");
    stopper.schedule();
    jest.advanceTimersByTime(1000);

    expect(processManager.stopApp).not.toHaveBeenCalled();
  });

  it("does not stop apps that are no longer running", async () => {
    const processManager = createProcessManager();
    processManager.getAppInstance.mockReturnValue(undefined);
    const stopper = createIdleProcessStopper(processManager, 1000);

    stopper.setTarget("com.example.app");
    stopper.schedule();
    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(processManager.stopApp).not.toHaveBeenCalled();
  });

  it("isolates stop errors and permits later scheduled stops", async () => {
    const warnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const processManager = createProcessManager();
    processManager.stopApp.mockRejectedValueOnce(new Error("stop failed"));
    const stopper = createIdleProcessStopper(processManager, 1000, "test app");

    try {
      stopper.setTarget("com.example.app");
      stopper.schedule();
      await jest.advanceTimersByTimeAsync(1000);
      stopper.setTarget("com.example.next");
      stopper.schedule();
      await jest.advanceTimersByTimeAsync(1000);
      expect(processManager.stopApp).toHaveBeenCalledWith("com.example.next");
    } finally {
      warnSpy.mockRestore();
    }
  });
});
