import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import {
  createEffectRuntime,
  type EffectRuntime,
} from "../../tests/support/effect-runtime";
import { createEvent } from "../events/event";
import { createFilesystemWatches } from "./watches";

describe("filesystem watch debounce", () => {
  let directory: string;
  let effects: EffectRuntime;
  let watches: Awaited<ReturnType<typeof acquireWatches>>;
  const removed = createEvent<{ viewId: number }>();
  const notify = jest.fn();
  const acquireWatches = () =>
    effects.acquire(
      Effect.gen(function* () {
        const scope = yield* Scope.fork(yield* Effect.scope);
        const service = yield* Scope.provide(
          createFilesystemWatches({
            resolveViewId: (id) => id,
            viewRemoved: removed,
            notify,
          }),
          scope,
        );
        return { ...service, close: () => Scope.close(scope, Exit.void) };
      }),
    );
  const advance = (milliseconds: number) =>
    effects.run(TestClock.adjust(Duration.millis(milliseconds)));

  beforeEach(async () => {
    directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "eden-watch-debounce-"),
    );
    effects = createEffectRuntime(TestClock.layer());
    notify.mockClear();
    watches = await acquireWatches();
  });
  afterEach(async () => {
    await effects.dispose();
    removed.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("coalesces changes per directory without cancelling another directory's notification", async () => {
    const leftPath = path.join(directory, "left");
    const rightPath = path.join(directory, "right");
    await fs.mkdir(leftPath);
    await fs.mkdir(rightPath);
    const left = await effects.run(watches.watch(leftPath, 1, "home"));
    const right = await effects.run(watches.watch(rightPath, 2, "home"));

    watches.invalidate(leftPath);
    await advance(50);
    watches.invalidate(leftPath);
    watches.invalidate(rightPath);
    await advance(50);
    expect(notify).not.toHaveBeenCalled();
    await advance(49);
    expect(notify).not.toHaveBeenCalled();
    await advance(1);
    expect(notify.mock.calls).toHaveLength(2);
    expect(notify.mock.calls).toEqual(
      expect.arrayContaining([
        [1, { watchId: left.watchId, kind: "change" }],
        [2, { watchId: right.watchId, kind: "change" }],
      ]),
    );
  });

  it("drops a pending notification when its watch is removed and lets a replacement watch debounce", async () => {
    const previous = await effects.run(watches.watch(directory, 1, "home"));
    watches.invalidate(directory);
    await advance(50);
    watches.unwatch(previous.watchId, 1);
    const replacement = await effects.run(watches.watch(directory, 1, "home"));
    watches.invalidate(directory);

    await advance(50);
    expect(notify).not.toHaveBeenCalled();
    await advance(50);
    expect(notify.mock.calls).toEqual([
      [1, { watchId: replacement.watchId, kind: "change" }],
    ]);
  });

  it("drops pending notifications when the service scope closes", async () => {
    await effects.run(watches.watch(directory, 1, "home"));
    watches.invalidate(directory);
    await effects.run(watches.close());
    await advance(100);
    expect(notify).not.toHaveBeenCalled();
  });
});
