import { randomUUID } from "node:crypto";
import type {
  FilesystemVolume,
  FilesystemVolumeRegistration,
} from "@edenapp/types";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Latch from "effect/Latch";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import type { EdenVolumeOptions } from "../../api/control-plane";
import type { Event } from "../../events/event";
import { scopedEvent } from "../../events/scoped";
import {
  type OperationReporter,
  type OperationTask,
  operationTask,
} from "../../operations/task";

import { io } from "../native-io";

import {
  type VolumeAccessError,
  type VolumeEjectError,
  VolumeEjectRejected,
  VolumeIoFailed,
  type VolumeRegistrationError,
  VolumeRegistrationRejected,
  VolumeUnavailable,
  volumeRegistrationRejection,
  volumeRejection,
} from "./errors";

export interface Volumes {
  list: () => FilesystemVolume[];
  /** Synchronously throws VolumeUnavailable when the volume cannot be addressed. */
  get: (id: string) => FilesystemVolume;
  register: (
    input: FilesystemVolumeRegistration,
    options?: EdenVolumeOptions | undefined,
  ) => Effect.Effect<FilesystemVolume, VolumeRegistrationError>;
  /** Synchronously throws VolumeUnavailable when asked to remove Home. */
  unregister: (id: string) => boolean;
  /** Synchronously reserves removal; throws VolumeUnavailable or VolumeEjectRejected. */
  prepareEject: (id: string) => OperationTask<void, VolumeEjectError>;
  /** Synchronously throws VolumeUnavailable before reserving accepted I/O. */
  prepareOperation: <R, E>(
    ids: string[],
    run: (reporter: OperationReporter) => Effect.Effect<R, E>,
  ) => OperationTask<R, E | VolumeUnavailable>;
  withVolumes: <A, E, R>(
    ids: string[],
    work: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | VolumeUnavailable, R>;
  // @eden-effect-next-line unresolved-requirements -- Lease acquisition belongs to the caller-owned descriptor or operation scope.
  lease: (
    ids: string[],
    inherit?: boolean,
  ) => Effect.Effect<VolumeAccess, VolumeUnavailable, Scope.Scope>;
  root: (
    id: string,
  ) => Effect.Effect<VolumeRoot | undefined, VolumeUnavailable>;
  changed: Event<{ volumes: FilesystemVolume[] }>;
}

export const Volumes = Context.Service<"eden/Volumes", Volumes>("eden/Volumes");

interface MountedVolume {
  info: FilesystemVolume;
  rootPath: string;
  device: number;
  inode: number;
  eject?: () => Effect.Effect<void, Error>;
  ejectGroup?: string;
  activeLeases: number;
  idle: Latch.Latch;
  removal?: Deferred.Deferred<void, VolumeEjectError>;
}

interface VolumeLease {
  entry: MountedVolume;
  released: boolean;
}

export interface VolumeRoot {
  rootPath: string;
  assertActive(): Effect.Effect<void, VolumeAccessError>;
}

/** Explicit admission for resources whose lifetime spans several commands. */
export interface VolumeAccess {
  effect<A, E, R>(
    work: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | VolumeUnavailable, R>;
  release(): void;
}

export const VolumesLive = Layer.effect(
  Volumes,
  Effect.gen(function* () {
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
    function list(): FilesystemVolume[] {
      return structuredClone([
        home,
        ...Array.from(mounted.values(), (entry) => entry.info),
      ]);
    }

    function get(id: string): FilesystemVolume {
      if (disposed)
        throw new VolumeUnavailable({
          volume: id,
          message: "Filesystem volumes are disposed",
        });
      const info = id === "home" ? home : mounted.get(id)?.info;
      if (!info)
        throw new VolumeUnavailable({
          volume: id,
          message: `Filesystem volume '${id}' is unavailable`,
        });
      return { ...info };
    }

    const register = Effect.fn(function* (
      input: FilesystemVolumeRegistration,
      options: EdenVolumeOptions = {},
    ) {
      const eject = options.eject?.bind(options);
      const rootPath = yield* io.realpath(input.rootPath);
      const stats = yield* io.stat(rootPath);
      yield* Effect.try({
        try: () => {
          if (!stats.isDirectory())
            throw new VolumeRegistrationRejected({
              volume: input.id,
              message: "Volume root must be a directory",
            });
          if (disposed)
            throw new VolumeRegistrationRejected({
              volume: input.id,
              message: "Filesystem volumes are disposed",
            });
          if (mounted.has(input.id))
            throw new VolumeRegistrationRejected({
              volume: input.id,
              message: `Volume '${input.id}' is already registered`,
            });
          if (
            options.ejectGroup &&
            [...mounted.values()].some(
              (entry) =>
                entry.ejectGroup === options.ejectGroup && entry.removal,
            )
          )
            throw new VolumeRegistrationRejected({
              volume: input.id,
              message:
                "Cannot register a volume while its eject group is being removed",
            });
        },
        catch: volumeRegistrationRejection,
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
        throw new VolumeUnavailable({
          volume: id,
          message: "The home volume cannot be unregistered",
        });
      if (!mounted.delete(id)) return false;
      changed.emit({ volumes: list() });
      return true;
    }

    /** Reserve removal synchronously so newly submitted I/O is rejected. */
    function prepareEject(id: string): OperationTask<void, VolumeEjectError> {
      get(id);
      if (id === "home")
        throw new VolumeEjectRejected({
          volume: id,
          message: "The home volume cannot be ejected",
        });
      const entry = mounted.get(id);
      if (!entry)
        throw new VolumeUnavailable({
          volume: id,
          message: `Filesystem volume '${id}' is unavailable`,
        });
      const operation = entry.eject;
      if (!operation)
        throw new VolumeEjectRejected({
          volume: id,
          message: `Filesystem volume '${id}' does not support eject`,
        });
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
        throw new VolumeEjectRejected({
          volume: id,
          message: "Cannot remove a volume from an active filesystem operation",
        });
      if (entry.removal) {
        const removal = entry.removal;
        return operationTask((reporter) =>
          Effect.suspend(() => {
            reporter.update("waiting-for-eject");
            return Deferred.await(removal);
          }),
        );
      }
      const removal = Deferred.makeUnsafe<void, VolumeEjectError>();
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
              yield* Effect.forEach(
                group,
                ([, sibling]) => sibling.idle.await,
                {
                  discard: true,
                },
              );
              for (const [volumeId, sibling] of group)
                yield* assertMounted(volumeId, sibling);
              reporter.update("host-eject");
              yield* operation().pipe(
                Effect.mapError(
                  (cause) =>
                    new VolumeIoFailed({
                      volume: id,
                      operation: "eject",
                      cause,
                      message: `Failed to eject filesystem volume '${id}': ${cause instanceof Error ? cause.message : String(cause)}`,
                    }),
                ),
              );
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
              Effect.fail(
                new VolumeEjectRejected({
                  volume: id,
                  message: "Volume eject was not executed",
                }),
              ),
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
        if (!entry)
          throw new VolumeUnavailable({
            volume: id,
            message: `Filesystem volume '${id}' is unavailable`,
          });
        const inherited = context.get(id);
        const alreadyAdmitted =
          inherited?.entry === entry && !inherited.released;
        if (!alreadyAdmitted && entry.info.state !== "ready")
          throw new VolumeUnavailable({
            volume: id,
            message: `Filesystem volume '${id}' is ${entry.info.state}`,
          });
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
    function prepareOperation<R, E>(
      ids: string[],
      run: (reporter: OperationReporter) => Effect.Effect<R, E>,
    ): OperationTask<R, E | VolumeUnavailable> {
      const access = acquire(ids, true);
      let started = false;
      return operationTask(
        (reporter) =>
          Effect.suspend(() => {
            if (started)
              return Effect.fail(
                new VolumeUnavailable({
                  volume: ids.join(","),
                  message: "Volume operation has already started",
                }),
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
        Effect.try({
          try: () => acquire(ids, inherit),
          catch: volumeRejection,
        }),
        (access) => Effect.sync(access.release),
      );
    }

    function withVolumes<A, E, R>(
      ids: string[],
      work: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | VolumeUnavailable, R> {
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
        ): Effect.Effect<A, E | VolumeUnavailable, R> =>
          Effect.suspend<A, E | VolumeUnavailable, R>(() =>
            released
              ? Effect.fail(
                  new VolumeUnavailable({
                    volume: ids.join(","),
                    message: "Filesystem volume access is closed",
                  }),
                )
              : Effect.provideService(work, effectContext, admitted.context),
          ),
        release: () => {
          if (released) return;
          released = true;
          admitted.release();
        },
      };
    }

    const assertMounted = Effect.fn(function* (
      id: string,
      entry: MountedVolume,
    ) {
      const assertRegistered = () => {
        if (disposed || mounted.get(id) !== entry)
          throw new VolumeUnavailable({
            volume: id,
            message: `Filesystem volume '${id}' is unavailable`,
          });
      };
      yield* Effect.try({ try: assertRegistered, catch: volumeRejection });
      const stats = yield* io.stat(entry.rootPath);
      yield* Effect.try({ try: assertRegistered, catch: volumeRejection });
      if (
        !stats.isDirectory() ||
        stats.dev !== entry.device ||
        stats.ino !== entry.inode
      )
        return yield* Effect.fail(
          new VolumeUnavailable({
            volume: id,
            message: `Filesystem volume '${id}' mount has changed`,
          }),
        );
    });

    function getRoot(
      id: string,
      inherited: Map<string, VolumeLease>,
    ): VolumeRoot | undefined {
      get(id);
      if (id === "home") return undefined;
      const entry = mounted.get(id);
      if (!entry)
        throw new VolumeUnavailable({
          volume: id,
          message: `Filesystem volume '${id}' is unavailable`,
        });
      const lease = inherited?.get(id);
      const assertAccessible = () => {
        if (
          entry.info.state !== "ready" &&
          !(lease?.entry === entry && !lease.released)
        )
          throw new VolumeUnavailable({
            volume: id,
            message: `Filesystem volume '${id}' is ${entry.info.state}`,
          });
      };
      assertAccessible();
      return {
        rootPath: entry.rootPath,
        assertActive: () =>
          Effect.gen(function* () {
            yield* Effect.try({
              try: assertAccessible,
              catch: volumeRejection,
            });
            yield* assertMounted(id, entry);
            yield* Effect.try({
              try: assertAccessible,
              catch: volumeRejection,
            });
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
          catch: volumeRejection,
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
  }),
);
