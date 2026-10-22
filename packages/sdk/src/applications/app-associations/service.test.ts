import type { AppAssociationStore } from "@edenapp/types";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import {
  buildService,
  createEffectRuntime,
} from "../../../tests/support/effect-runtime";
import {
  ExecutionContext,
  ExecutionContextLive,
} from "../../core/execution/context";
import { FilesystemIoFailed } from "../../platform/filesystem/native-errors";
import { AppsDirectory, DistPath, RuntimeConfig } from "../../runtime/inputs";
import { PackageCatalog, PackageCatalogLive } from "../packages/catalog";
import {
  InstalledPackages,
  InstalledPackagesLive,
} from "../packages/installed";

import { AppAssociationStorage } from "./ports";
import { AppAssociations, AppAssociationsLive } from "./service";

const runtimes: ReturnType<typeof createEffectRuntime>[] = [];

async function createAssociations(storage: AppAssociationStorage) {
  const runtime = createEffectRuntime();
  runtimes.push(runtime);
  const registry = runtime.acquireSync(
    buildService(InstalledPackages, InstalledPackagesLive),
  );
  const execution = runtime.acquireSync(
    buildService(ExecutionContext, ExecutionContextLive).pipe(
      Effect.provideService(RuntimeConfig, {}),
    ),
  );
  const catalog = runtime.acquireSync(
    buildService(PackageCatalog, PackageCatalogLive).pipe(
      Effect.provideService(InstalledPackages, registry),
      Effect.provideService(ExecutionContext, execution),
      Effect.provideService(AppsDirectory, "/unused"),
      Effect.provideService(DistPath, "/unused"),
    ),
  );
  const associations = await runtime.acquire(
    buildService(AppAssociations, AppAssociationsLive).pipe(
      Effect.provideService(PackageCatalog, catalog),
      Effect.provideService(AppAssociationStorage, storage),
    ),
  );
  await runtime.run(associations.initialize());
  return { runtime, associations };
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.dispose();
});

it("persists both concurrent mutations and publishes only committed state", async () => {
  const writing = Deferred.makeUnsafe<void>();
  const releaseWrite = Deferred.makeUnsafe<void>();
  let persisted = JSON.stringify({ version: 1, associations: {} });
  let writes = 0;
  const { runtime, associations } = await createAssociations({
    read: () => Effect.succeed(persisted),
    write: (content) =>
      Effect.gen(function* () {
        if (++writes === 1) {
          yield* Deferred.succeed(writing, undefined);
          yield* Deferred.await(releaseWrite);
        }
        persisted = content;
      }),
  });
  const first = { appId: "com.example.first", kind: "provider" };
  const second = { appId: "com.example.second", kind: "provider" };

  const pending = await runtime.run(
    Effect.gen(function* () {
      const firstMutation = yield* Effect.forkChild(
        associations.set("first", first),
        { startImmediately: true },
      );
      yield* Deferred.await(writing);
      const secondMutation = yield* Effect.forkChild(
        associations.set("second", second),
        { startImmediately: true },
      );
      const beforeCommit = associations.list();
      yield* Deferred.succeed(releaseWrite, undefined);
      yield* Fiber.join(firstMutation);
      yield* Fiber.join(secondMutation);
      return beforeCommit;
    }),
  );

  expect(JSON.parse(persisted)).toEqual({
    version: 1,
    associations: { first, second },
  });
  expect(associations.list()).toEqual({ first, second });
  expect(pending).toEqual({});
});

it.each(["set", "remove"] as const)(
  "keeps committed state after a failed %s and permits the next mutation",
  async (mutation) => {
    const existing = { appId: "com.example.existing", kind: "provider" };
    const store: AppAssociationStore = {
      version: 1,
      associations: { existing },
    };
    let persisted = JSON.stringify(store);
    let failWrite = true;
    const failure = new FilesystemIoFailed({
      path: "/unavailable/app-associations.json",
      operation: "writeFile",
      message: "Association storage is unavailable",
      cause: new Error("Association storage is unavailable"),
    });
    const { runtime, associations } = await createAssociations({
      read: () => Effect.succeed(persisted),
      write: (content) =>
        Effect.suspend(() =>
          failWrite
            ? Effect.fail(failure)
            : Effect.sync(() => {
                persisted = content;
              }),
        ),
    });
    const rejected = { appId: "com.example.rejected", kind: "provider" };

    await expect(
      runtime.run(
        mutation === "set"
          ? associations.set("rejected", rejected)
          : associations.remove("existing"),
      ),
    ).rejects.toBe(failure);
    expect(associations.list()).toEqual({ existing });
    expect(JSON.parse(persisted)).toEqual(store);

    failWrite = false;
    const next = { appId: "com.example.next", kind: "provider" };
    await runtime.run(associations.set("next", next));
    expect(associations.list()).toEqual({ existing, next });
    expect(JSON.parse(persisted)).toEqual({
      version: 1,
      associations: { existing, next },
    });
  },
);
