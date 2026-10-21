import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import { Volumes, VolumesLive } from "../../../src/filesystem/volumes";
import type { OperationTask } from "../../../src/operations/task";
import {
  buildService,
  createEffectRuntime,
  type EffectRuntime,
} from "../../support/effect-runtime";

function runTask<A>(
  runtime: EffectRuntime,
  task: OperationTask<A>,
): Promise<A> {
  const work = task.run({ update() {} });
  return Effect.isEffect(work) ? runtime.run(work) : work;
}

it("keeps admitted volume access independent when two runtimes use the same volume ID", async () => {
  const first = createEffectRuntime();
  const second = createEffectRuntime();
  const rootPath = await fs.mkdtemp(
    path.join(os.tmpdir(), "eden-volume-isolation-"),
  );
  try {
    const a = await first.acquire(buildService(Volumes, VolumesLive));
    const b = await second.acquire(buildService(Volumes, VolumesLive));
    const input = {
      id: "usb",
      label: "USB",
      kind: "removable" as const,
      rootPath,
    };
    const eject = jest.fn(() => Effect.void);
    await first.run(a.register(input, { eject }));
    await second.run(b.register(input));
    const admitted = a.prepareOperation(["usb"], () =>
      b.withVolumes(
        ["usb"],
        Effect.gen(function* () {
          const root = yield* a.root("usb");
          if (!root) throw new Error("Registered volume has no root");
          yield* root.assertActive();
          return root.rootPath;
        }),
      ),
    );
    const removing = runTask(first, a.prepareEject("usb"));
    expect(a.get("usb").state).toBe("ejecting");
    expect(eject).not.toHaveBeenCalled();
    await expect(runTask(first, admitted)).resolves.toBe(rootPath);
    await removing;
    expect(eject).toHaveBeenCalledTimes(1);
    expect(b.get("usb").state).toBe("ready");
  } finally {
    await first.dispose();
    await second.dispose();
    await fs.rm(rootPath, { recursive: true, force: true });
  }
});
