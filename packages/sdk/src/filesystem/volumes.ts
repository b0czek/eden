import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import type {
  FilesystemVolume,
  FilesystemVolumeRegistration,
} from "@edenapp/types";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Latch from "effect/Latch";
import type { EdenVolumeOptions } from "../api/control-plane";
import { asError, fromPromise } from "../effects/io";
import { scopedEvent } from "../events/scoped";

import {
  type OperationReporter,
  type OperationTask,
  operationTask,
} from "../operations/task";

interface MountedVolume {
  info: FilesystemVolume;
  rootPath: string;
  device: number;
  inode: number;
  eject?: () => Effect.Effect<void, Error>;
  ejectGroup?: string;
  activeLeases: number;
  idle: Latch.Latch;
  removal?: Deferred.Deferred<void, Error>;
}

interface VolumeLease {
  entry: MountedVolume;
  released: boolean;
}

export interface VolumeRoot {
  rootPath: string;
  assertActive(): Effect.Effect<void, Error>;
}

/** Explicit admission for resources whose lifetime spans several commands. */
export interface VolumeAccess {
  effect<A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E | Error, R>;
  release(): void;
}

export const createVolumes = Effect.fn(function* () {
  const changed = yield* scopedEvent<{ volumes: FilesystemVolume[] }>();
  const mounted = new Map<string, MountedVolume>();
  const effectContext = Context.Reference<Map<string, VolumeLease>>(
    `eden/filesystem/volume-leases/${randomUUID()}`,
    { defaultValue: () => new Map() },
  );
  const currentLeases = () => Fiber.getCurrent()?.getRef(effectContext);
  let disposed = false;
  const home: FilesystemVolume = {
    id: "home",
    label: "Home",
    kind: "local",
    readOnly: false,
    supportsWatch: true,
    supportsEject: false,
    state: "ready",
  };
  const io = <A>(run: () => Promise<A>) =>
    fromPromise(run).pipe(Effect.uninterruptible);
  function list(): FilesystemVolume[] {
    return structuredClone([
      home,
      ...Array.from(mounted.values(), (entry) => entry.info),
    ]);
  }

  function get(id: string): FilesystemVolume {
    if (disposed) throw new Error("Filesystem volumes are disposed");
    const info = id === "home" ? home : mounted.get(id)?.info;
    if (!info) throw new Error(`Filesystem volume '${id}' is unavailable`);
    return { ...info };
  }

  const register = Effect.fn(function* (
    input: FilesystemVolumeRegistration,
    options: EdenVolumeOptions = {},
  ) {
    const eject = options.eject?.bind(options);
    const rootPath = yield* io(() => fs.realpath(input.rootPath));
    const stats = yield* io(() => fs.stat(rootPath));
    yield* Effect.try({
      try: () => {
        if (!stats.isDirectory())
          throw new Error("Volume root must be a directory");
        if (disposed) throw new Error("Filesystem volumes are disposed");
        if (mounted.has(input.id))
          throw new Error(`Volume '${input.id}' is already registered`);
        if (
          options.ejectGroup &&
          [...mounted.values()].some(
            (entry) => entry.ejectGroup === options.ejectGroup && entry.removal,
          )
        )
          throw new Error(
            "Cannot register a volume while its eject group is being removed",
          );
      },
      catch: asError,
    });
    const info: FilesystemVolume = {
      id: input.id,
      label: input.label,
      kind: input.kind,
      readOnly: input.readOnly ?? false,
      supportsWatch: input.supportsWatch ?? input.kind !== "network",
      supportsEject: eject !== undefined,
      state: "ready",
    };
    mounted.set(input.id, {
      info,
      rootPath,
      device: stats.dev,
      inode: stats.ino,
      eject,
      ejectGroup: options.ejectGroup,
      activeLeases: 0,
      idle: Latch.makeUnsafe(true),
    });
    changed.emit({ volumes: list() });
    return { ...info };
  });

  function unregister(id: string): boolean {
    if (id === "home")
      throw new Error("The home volume cannot be unregistered");
    if (!mounted.delete(id)) return false;
    changed.emit({ volumes: list() });
    return true;
  }

  /** Reserve removal synchronously so newly submitted I/O is rejected. */
  function prepareEject(id: string): OperationTask<void> {
    get(id);
    if (id === "home") throw new Error("The home volume cannot be ejected");
    const entry = mounted.get(id);
    if (!entry) throw new Error(`Filesystem volume '${id}' is unavailable`);
    const operation = entry.eject;
    if (!operation)
      throw new Error(`Filesystem volume '${id}' does not support eject`);
    const group = entry.ejectGroup
      ? [...mounted.entries()].filter(
          ([, sibling]) => sibling.ejectGroup === entry.ejectGroup,
        )
      : [[id, entry] as const];
    if (
      group.some(([volumeId, sibling]) => {
        const lease = currentLeases()?.get(volumeId);
        return lease?.entry === sibling && !lease.released;
      })
    )
      throw new Error(
        "Cannot remove a volume from an active filesystem operation",
      );
    if (entry.removal) {
      const removal = entry.removal;
      return operationTask((reporter) =>
        Effect.suspend(() => {
          reporter.update("waiting-for-eject");
          return Deferred.await(removal);
        }),
      );
    }
    const removal = Deferred.makeUnsafe<void, Error>();
    for (const [, sibling] of group) {
      sibling.removal = removal;
      sibling.info.state = "ejecting";
    }
    changed.emit({ volumes: list() });
    let started = false;
    function restoreReady() {
      for (const [volumeId, sibling] of group) {
        if (!disposed && mounted.get(volumeId) === sibling) {
          sibling.removal = undefined;
          sibling.info.state = "ready";
        }
      }
      if (!disposed) changed.emit({ volumes: list() });
    }
    return operationTask(
      (reporter) =>
        Effect.suspend(() => {
          if (started) return Deferred.await(removal);
          started = true;
          return Effect.gen(function* () {
            reporter.update("draining-volume-io");
            yield* Effect.forEach(group, ([, sibling]) => sibling.idle.await, {
              discard: true,
            });
            for (const [volumeId, sibling] of group)
              yield* assertMounted(volumeId, sibling);
            reporter.update("host-eject");
            yield* operation();
            for (const [volumeId, sibling] of group)
              if (mounted.get(volumeId) === sibling) unregister(volumeId);
          }).pipe(
            Effect.onError(() => Effect.sync(restoreReady)),
            Deferred.into(removal),
            Effect.andThen(Deferred.await(removal)),
          );
        }).pipe(Effect.uninterruptible),
      {
        release: () => {
          if (started || Deferred.isDoneUnsafe(removal)) return;
          restoreReady();
          Deferred.doneUnsafe(
            removal,
            Effect.fail(new Error("Volume eject was not executed")),
          );
        },
      },
    );
  }

  function admit(
    ids: string[],
    inherit: boolean,
    inherited = currentLeases(),
  ): {
    context: Map<string, VolumeLease>;
    release: () => void;
  } {
    const context = new Map(inherit ? inherited : undefined);
    const entries = new Map<string, MountedVolume>();
    for (const id of new Set(ids)) {
      get(id);
      if (id === "home") continue;
      const entry = mounted.get(id);
      if (!entry) throw new Error(`Filesystem volume '${id}' is unavailable`);
      const inherited = context.get(id);
      const alreadyAdmitted = inherited?.entry === entry && !inherited.released;
      if (!alreadyAdmitted && entry.info.state !== "ready")
        throw new Error(`Filesystem volume '${id}' is ${entry.info.state}`);
      entries.set(id, entry);
    }
    const releases: (() => void)[] = [];
    for (const [id, entry] of entries) {
      const lease: VolumeLease = { entry, released: false };
      context.set(id, lease);
      entry.activeLeases++;
      entry.idle.closeUnsafe();
      releases.push(() => {
        lease.released = true;
        if (--entry.activeLeases === 0) entry.idle.openUnsafe();
      });
    }
    return {
      context,
      release: () => {
        for (const release of releases) release();
      },
    };
  }

  /** Admission belongs to acceptance even when execution is still queued. */
  function prepareOperation<R>(
    ids: string[],
    run: (reporter: OperationReporter) => Effect.Effect<R, unknown>,
  ): OperationTask<R> {
    const access = acquire(ids, true);
    let started = false;
    return operationTask(
      (reporter) =>
        Effect.suspend(() => {
          if (started)
            return Effect.fail(
              new Error("Volume operation has already started"),
            );
          started = true;
          return access
            .effect(Effect.suspend(() => run(reporter)))
            .pipe(Effect.ensuring(Effect.sync(access.release)));
        }),
      { release: access.release },
    );
  }

  /** Scope a volume lease, independently for retained descriptors. */
  function lease(ids: string[], inherit = true) {
    return Effect.acquireRelease(
      Effect.try({ try: () => acquire(ids, inherit), catch: asError }),
      (access) => Effect.sync(access.release),
    );
  }

  function withVolumes<A, E>(
    ids: string[],
    work: Effect.Effect<A, E>,
  ): Effect.Effect<A, E | Error> {
    return Effect.scoped(
      Effect.flatMap(lease(ids), (access) => access.effect(work)),
    );
  }

  function acquire(
    ids: string[],
    inherit = false,
    inherited?: Map<string, VolumeLease>,
  ): VolumeAccess {
    const admitted = admit(ids, inherit, inherited);
    let released = false;
    return {
      effect: <A, E, R>(
        work: Effect.Effect<A, E, R>,
      ): Effect.Effect<A, E | Error, R> =>
        Effect.suspend<A, E | Error, R>(() =>
          released
            ? Effect.fail(new Error("Filesystem volume access is closed"))
            : Effect.provideService(work, effectContext, admitted.context),
        ),
      release: () => {
        if (released) return;
        released = true;
        admitted.release();
      },
    };
  }

  const assertMounted = Effect.fn(function* (id: string, entry: MountedVolume) {
    const assertRegistered = () => {
      if (disposed || mounted.get(id) !== entry)
        throw new Error(`Filesystem volume '${id}' is unavailable`);
    };
    yield* Effect.try({ try: assertRegistered, catch: asError });
    const stats = yield* io(() => fs.stat(entry.rootPath));
    yield* Effect.try({ try: assertRegistered, catch: asError });
    if (
      !stats.isDirectory() ||
      stats.dev !== entry.device ||
      stats.ino !== entry.inode
    )
      return yield* Effect.fail(
        new Error(`Filesystem volume '${id}' mount has changed`),
      );
  });

  function getRoot(
    id: string,
    inherited: Map<string, VolumeLease>,
  ): VolumeRoot | undefined {
    get(id);
    if (id === "home") return undefined;
    const entry = mounted.get(id);
    if (!entry) throw new Error(`Filesystem volume '${id}' is unavailable`);
    const lease = inherited?.get(id);
    const assertAccessible = () => {
      if (
        entry.info.state !== "ready" &&
        !(lease?.entry === entry && !lease.released)
      )
        throw new Error(`Filesystem volume '${id}' is ${entry.info.state}`);
    };
    assertAccessible();
    return {
      rootPath: entry.rootPath,
      assertActive: () =>
        Effect.gen(function* () {
          yield* Effect.try({ try: assertAccessible, catch: asError });
          yield* assertMounted(id, entry);
          yield* Effect.try({ try: assertAccessible, catch: asError });
        }),
    };
  }

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      disposed = true;
      mounted.clear();
    }),
  );
  const root = (id: string) =>
    Effect.flatMap(effectContext, (inherited) =>
      Effect.try({
        try: () => getRoot(id, inherited),
        catch: asError,
      }),
    );
  return {
    list,
    get,
    register,
    unregister,
    prepareEject,
    prepareOperation,
    withVolumes,
    lease,
    root,
    changed,
  };
});

export type Volumes = Effect.Success<ReturnType<typeof createVolumes>>;
