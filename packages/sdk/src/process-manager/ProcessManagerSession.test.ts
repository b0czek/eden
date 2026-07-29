import "reflect-metadata";

import { ProcessManager } from "./ProcessManager";

describe("ProcessManager session cleanup", () => {
  it("attempts to stop every app and reports aggregate failure", async () => {
    const manager = Object.create(ProcessManager.prototype) as ProcessManager;
    Object.assign(manager, {
      runningApps: new Map([
        ["app.one", {}],
        ["app.two", {}],
        ["app.three", {}],
      ]),
    });
    const stopApp = jest.spyOn(manager, "stopApp");
    stopApp.mockImplementation(async (appId) => {
      if (appId === "app.two") throw new Error("stop failed");
    });

    await expect(manager.stopSessionApps()).rejects.toThrow(
      "Failed to stop all session apps",
    );
    expect(stopApp.mock.calls.map(([appId]) => appId)).toEqual([
      "app.one",
      "app.two",
      "app.three",
    ]);
  });
});
