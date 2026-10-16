import { createProcessIdleTimeout } from "./idle-timeout";

type ProcessesMock = jest.Mocked<
  Parameters<typeof createProcessIdleTimeout>[0]
>;

const createProcesses = (): ProcessesMock => ({
  getAppInstance: jest.fn((_appId: string) => ({}) as never),
  stopApp: jest.fn(async (_appId: string) => undefined),
});

describe("ProcessIdleTimeout", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("schedules the current target after delay", async () => {
    const processes = createProcesses();
    const stopper = createProcessIdleTimeout(processes, 1000, "test app");

    stopper.setTarget("com.example.app");
    stopper.schedule();
    jest.advanceTimersByTime(999);
    expect(processes.stopApp).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    await Promise.resolve();

    expect(processes.stopApp).toHaveBeenCalledWith("com.example.app");
  });

  it("schedule with no target does nothing", () => {
    const processes = createProcesses();
    const stopper = createProcessIdleTimeout(processes, 1000);

    stopper.schedule();
    jest.advanceTimersByTime(1000);

    expect(processes.stopApp).not.toHaveBeenCalled();
  });

  it("cancel prevents the scheduled stop", () => {
    const processes = createProcesses();
    const stopper = createProcessIdleTimeout(processes, 1000);

    stopper.setTarget("com.example.app");
    stopper.schedule();
    stopper.cancel();
    jest.advanceTimersByTime(1000);

    expect(processes.stopApp).not.toHaveBeenCalled();
  });

  it("changing target before the timer fires stops only the latest target", async () => {
    const processes = createProcesses();
    const stopper = createProcessIdleTimeout(processes, 1000);

    stopper.setTarget("com.example.first");
    stopper.schedule();
    jest.advanceTimersByTime(500);
    stopper.setTarget("com.example.second");
    stopper.schedule();
    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(processes.stopApp).toHaveBeenCalledTimes(1);
    expect(processes.stopApp).toHaveBeenCalledWith("com.example.second");
  });

  it("clearTarget only clears the matching target", async () => {
    const processes = createProcesses();
    const stopper = createProcessIdleTimeout(processes, 1000);

    stopper.setTarget("com.example.app");
    stopper.clearTarget("com.example.other");
    stopper.schedule();
    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(processes.stopApp).toHaveBeenCalledWith("com.example.app");

    processes.stopApp.mockClear();
    stopper.setTarget("com.example.app");
    stopper.clearTarget("com.example.app");
    stopper.schedule();
    jest.advanceTimersByTime(1000);

    expect(processes.stopApp).not.toHaveBeenCalled();
  });

  it("does not stop apps that are no longer running", async () => {
    const processes = createProcesses();
    processes.getAppInstance.mockReturnValue(undefined);
    const stopper = createProcessIdleTimeout(processes, 1000);

    stopper.setTarget("com.example.app");
    stopper.schedule();
    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(processes.stopApp).not.toHaveBeenCalled();
  });

  it("isolates stop errors and permits later scheduled stops", async () => {
    const warnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const processes = createProcesses();
    processes.stopApp.mockRejectedValueOnce(new Error("stop failed"));
    const stopper = createProcessIdleTimeout(processes, 1000, "test app");

    try {
      stopper.setTarget("com.example.app");
      stopper.schedule();
      await jest.advanceTimersByTimeAsync(1000);
      stopper.setTarget("com.example.next");
      stopper.schedule();
      await jest.advanceTimersByTimeAsync(1000);
      expect(processes.stopApp).toHaveBeenCalledWith("com.example.next");
    } finally {
      warnSpy.mockRestore();
    }
  });
});
