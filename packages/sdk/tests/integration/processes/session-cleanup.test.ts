import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { testApp } from "../../support/apps";
import { createTestCaller } from "../../support/callers";
import { createTestEden, type TestEden } from "../../support/create-test-eden";

describe("session cleanup failure composition", () => {
  let eden: TestEden;
  const appIds = ["first.app", "second.app"];
  beforeEach(async () => {
    eden = await createTestEden();
    const { execution, processes, installedPackages } = eden.runtime.services;
    const { user } = await createTestCaller(eden, "launcher.app", []);
    for (const appId of appIds) {
      installedPackages.register(testApp(appId));
      await eden.runtime.effects.run(
        execution.provide(processes.launchApp(appId), {
          principal: { kind: "user", profile: user },
        }),
      );
    }
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await eden.dispose();
  });

  it("attempts both apps and reports expected failure when native close and fallback close fail", async () => {
    const { processes, views, runtimeContexts } = eden.runtime.services;
    const first = processes.getAppInstance(appIds[0]);
    const second = processes.getAppInstance(appIds[1]);
    if (!first || !second)
      throw new Error("Expected both session apps to be running");
    const contents = views.getView(first.viewId)?.webContents;
    if (!contents) throw new Error("Expected the first app's native view");
    jest.spyOn(contents, "close").mockImplementation(() => {
      throw new Error("Native close failed");
    });

    const exit = await eden.runtime.effects.run(
      Effect.exit(processes.stopSessionApps()),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(false);
      expect(Cause.squash(exit.cause)).toMatchObject({
        _tag: "SessionProcessesStopFailed",
      });
    }
    for (const appId of appIds) {
      expect(processes.getAppInstance(appId)).toBeUndefined();
      expect(runtimeContexts.get(appId)).toBeUndefined();
    }
    expect(views.getView(first.viewId)).toBeUndefined();
    expect(views.getView(second.viewId)).toBeUndefined();
  });

  it("attempts the remaining apps and preserves unexpected cleanup defects", async () => {
    const { processes, views } = eden.runtime.services;
    const firstView = processes.getAppInstance(appIds[0])?.viewId;
    if (firstView === undefined)
      throw new Error("Expected the first app's view");
    const defect = new Error("Unexpected cleanup defect");
    const removeView = views.removeView;
    jest
      .spyOn(views, "removeView")
      .mockImplementation((viewId) =>
        viewId === firstView
          ? removeView(viewId).pipe(Effect.andThen(Effect.die(defect)))
          : removeView(viewId),
      );
    const exit = await eden.runtime.effects.run(
      Effect.exit(processes.stopSessionApps()),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.squash(exit.cause)).toBe(defect);
    }
    for (const appId of appIds)
      expect(processes.getAppInstance(appId)).toBeUndefined();
    expect(views.getAllViews()).toEqual([]);
  });
});
