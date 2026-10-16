import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import type {
  FilesystemVolume,
  FilesystemVolumeRegistration,
} from "@edenapp/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
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
  eject?: () => Promise<void>;
  ejectGroup?: string;
  activeOperations: Set<Promise<void>>;
  removal?: Promise<void>;
}

interface VolumeLease {
  entry: MountedVolume;
  released: boolean;
}

export interface VolumeRoot {
  rootPath: string;
  assertActive(): Promise<void>;
}

/** Explicit admission for resources whose lifetime spans several commands. */
export interface VolumeAccess {
  run<T>(operation: () => Promise<T>): Promise<T>;
  effect<A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, E | Error>;
  release(): void;
}

export const createVolumes = Effect.fn(function* () {
  const changed = yield* scopedEvent<{ volumes: FilesystemVolume[] }>();
  const mounted = new Map<string, MountedVolume>();
  const operationContext = new AsyncLocalStorage<Map<string, VolumeLease>>();
  const effectContext = Context.Reference<Map<string, VolumeLease>>(
    `eden/filesystem/volume-leases/${randomUUID()}`,
    { defaultValue: () => new Map() },
  );
  const currentLeases = () =>
    operationContext.getStore() ?? Fiber.getCurrent()?.getRef(effectContext);
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
      activeOperations: new Set(),
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
        io(async () => {
          reporter.update("waiting-for-eject");
          await removal;
        }),
      );
    }
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const removal = new Promise<void>((complete, fail) => {
      resolve = complete;
      reject = fail;
    });
    // Reservation may precede execution; attach an owned rejection observer.
    void removal.catch(() => undefined);
    for (const [, sibling] of group) {
      sibling.removal = removal;
      sibling.info.state = "ejecting";
    }
    changed.emit({ volumes: list() });
    let started = false;
    return operationTask((reporter) =>
      Effect.gen(function* () {
        if (started) return yield* io(() => removal);
        started = true;
        yield* Effect.gen(function* () {
          reporter.update("draining-volume-io");
          yield* io(() =>
            Promise.all(
              group.flatMap(([, sibling]) => [...sibling.activeOperations]),
            ),
          );
          for (const [volumeId, sibling] of group)
            yield* io(() => assertMounted(volumeId, sibling));
          reporter.update("host-eject");
          yield* io(operation);
          for (const [volumeId, sibling] of group)
            if (mounted.get(volumeId) === sibling) unregister(volumeId);
          resolve();
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              for (const [volumeId, sibling] of group) {
                if (!disposed && mounted.get(volumeId) === sibling) {
                  sibling.removal = undefined;
                  sibling.info.state = "ready";
                }
              }
              if (!disposed) changed.emit({ volumes: list() });
              reject(error);
            }),
          ),
        );
        yield* io(() => removal);
      }).pipe(Effect.uninterruptible),
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
      if (inherited?.entry === entry && !inherited.released) continue;
      if (entry.info.state !== "ready")
        throw new Error(`Filesystem volume '${id}' is ${entry.info.state}`);
      entries.set(id, entry);
    }
    const releases: (() => void)[] = [];
    for (const [id, entry] of entries) {
      const lease: VolumeLease = { entry, released: false };
      context.set(id, lease);
      let resolve!: () => void;
      const done = new Promise<void>((complete) => {
        resolve = complete;
      });
      entry.activeOperations.add(done);
      releases.push(() => {
        lease.released = true;
        entry.activeOperations.delete(done);
        resolve();
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

  /** Hold an admission until a native Effect finishes, including failure/interruption. */
  function withVolumes<A, E>(
    ids: string[],
    work: Effect.Effect<A, E>,
  ): Effect.Effect<A, E | Error> {
    return Effect.gen(function* () {
      const inherited = yield* effectContext;
      return yield* Effect.acquireUseRelease(
        Effect.try({
          try: () => acquire(ids, true, inherited),
          catch: asError,
        }),
        (access) => access.effect(work),
        (access) => Effect.sync(access.release),
      );
    });
  }

  function acquire(
    ids: string[],
    inherit = false,
    inherited?: Map<string, VolumeLease>,
  ): VolumeAccess {
    const admitted = admit(ids, inherit, inherited);
    let released = false;
    return {
      run: (operation) => {
        if (released) throw new Error("Filesystem volume access is closed");
        return operationContext.run(admitted.context, operation);
      },
      effect: <A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, E | Error> =>
        Effect.suspend<A, E | Error, never>(() =>
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

  async function assertMounted(
    id: string,
    entry: MountedVolume,
  ): Promise<void> {
    const assertRegistered = () => {
      if (disposed || mounted.get(id) !== entry)
        throw new Error(`Filesystem volume '${id}' is unavailable`);
    };
    assertRegistered();
    const stats = await fs.stat(entry.rootPath);
    assertRegistered();
    if (
      !stats.isDirectory() ||
      stats.dev !== entry.device ||
      stats.ino !== entry.inode
    )
      throw new Error(`Filesystem volume '${id}' mount has changed`);
  }

  function getRoot(
    id: string,
    inherited = currentLeases(),
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
      assertActive: async () => {
        assertAccessible();
        await assertMounted(id, entry);
        assertAccessible();
      },
    };
  }

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      disposed = true;
      mounted.clear();
      operationContext.disable();
    }),
  );
  const root = (id: string) =>
    Effect.flatMap(effectContext, (inherited) =>
      Effect.try({
        try: () => service.getRoot(id, inherited),
        catch: asError,
      }),
    );
  const service = {
    list,
    get,
    register,
    unregister,
    prepareEject,
    prepareOperation,
    withVolumes,
    acquire,
    getRoot,
    root,
    changed,
  };
  return service;
});

export type Volumes = Effect.Success<ReturnType<typeof createVolumes>>;
