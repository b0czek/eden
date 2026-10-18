import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { OperationProgress } from "@edenapp/types";
import * as TestClock from "effect/testing/TestClock";
import { createEffectRuntime } from "../../tests/support/effect-runtime";
import { createFileTransfers } from "./transfers";

it("reports initial copy progress at clock zero and throttles subsequent progress until time advances", async () => {
  const effects = createEffectRuntime(TestClock.layer());
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "eden-transfer-clock-"),
  );
  const source = path.join(directory, "source");
  const destination = path.join(directory, "destination");
  const size = 3 * 1024 * 1024;
  const updates: OperationProgress[] = [];
  try {
    await fs.writeFile(source, Buffer.alloc(size, 0x5a));
    await effects.run(
      createFileTransfers().copy({
        source,
        destination,
        destinationLabel: "destination",
        overwrite: false,
        reporter: {
          update: (phase, progress) => {
            if (phase === "copying" && progress) updates.push(progress);
          },
        },
      }),
    );

    expect(updates[0]).toMatchObject({
      completed: 0,
      total: size,
      unit: "bytes",
    });
    expect(
      updates.filter(({ completed }) => completed > 0 && completed < size),
    ).toHaveLength(1);
    expect(updates.at(-1)).toMatchObject({ completed: size, total: size });
  } finally {
    await effects.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
