import type { OperationHandle } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { command, defineController } from "../../../src/controllers/controller";
import { operationTask } from "../../../src/operations/task";
import { testApp } from "../../support/apps";
import { gate } from "../../support/async";
import { createTestCaller } from "../../support/callers";
import { createTestEden, type TestEden } from "../../support/createTestEden";

describe("renderer command completion", () => {
  const appId = "app.renderer-completion";
  let eden: TestEden;
  let webContentsId: number;
  let work: Effect.Effect<string, Error>;
  let finish: ReturnType<typeof gate<string>>;

  beforeEach(async () => {
    eden = await createTestEden();
    finish = gate<string>();
    work = Effect.succeed("finished");
    eden.runtime.services.installedPackages.register(testApp(appId));
    const { user } = await createTestCaller(eden, appId, ["completion/*"]);
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(user.username, "password"),
    );
    await eden.complete("process/launch", { appId });
    webContentsId = eden.getAppView(appId).view.webContents.id;
    eden.runtime.services.commands.registerController(
      defineController("completion", {
        commands: {
          immediate: command({ handle: () => "immediate" }),
          run: command({
            mode: "operation",
            handle: () => operationTask(() => work),
          }),
        },
      }),
    );
  });

  afterEach(async () => {
    finish?.release("cleanup");
    await eden?.dispose();
  });

  it("preserves result responses and returns accepted handles with submission metadata by default", async () => {
    await expect(
      eden.executeFromView(
        webContentsId,
        "completion/immediate",
        {},
        {
          waitForCompletion: true,
        },
      ),
    ).resolves.toBe("immediate");
    const options = { submission: { requestKey: "renderer-work" } };
    const handle = await eden.executeFromView<OperationHandle>(
      webContentsId,
      "completion/run",
      {},
      options,
    );
    expect(handle).toEqual({
      command: "completion/run",
      id: expect.any(String),
    });
    await expect(
      eden.executeFromView(webContentsId, "completion/run", {}, options),
    ).resolves.toEqual(handle);
  });

  it("waits for completion and returns the result even after the submitting view closes", async () => {
    const started = gate();
    work = Effect.gen(function* () {
      started.release();
      return yield* Effect.promise(() => finish.promise);
    });
    let settled = false;
    const result = eden
      .executeFromView(
        webContentsId,
        "completion/run",
        {},
        {
          waitForCompletion: true,
        },
      )
      .finally(() => {
        settled = true;
      });
    await started.promise;
    expect(settled).toBe(false);
    await eden.complete("process/stop", { appId });
    finish.release("completed after close");
    await expect(result).resolves.toBe("completed after close");
  });

  it("rejects with the operation failure when waiting for completion", async () => {
    work = Effect.fail(new Error("Work refused"));
    await expect(
      eden.executeFromView(
        webContentsId,
        "completion/run",
        {},
        {
          waitForCompletion: true,
        },
      ),
    ).rejects.toThrow("Work refused");
  });
});
