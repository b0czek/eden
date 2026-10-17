import { randomUUID } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import type {
  FilesystemHandle,
  FilesystemLocation,
  FilesystemOpenMode,
  FilesystemSource,
} from "@edenapp/types";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Latch from "effect/Latch";
import * as Scope from "effect/Scope";
import { asError, fromPromise } from "../effects/io";
import type {
  EffectivePrincipal,
  ExecutionContext,
} from "../execution/context";

export interface OpenedFilesystemFile {
  use<A, E>(
    operation: (file: FileHandle) => Effect.Effect<A, E>,
  ): Effect.Effect<A, E | Error>;
}

interface HandleOwner {
  appId: string;
  sessionId?: string;
  principalKind: EffectivePrincipal["kind"];
  username?: string;
  webContentsId?: number;
}

interface HandleEntry {
  owner?: HandleOwner;
  retained: boolean;
  scope: Scope.Closeable;
  opened: Deferred.Deferred<OpenedFilesystemFile, Error>;
  closed: Deferred.Deferred<void>;
  idle: Latch.Latch;
  active: number;
  closing: boolean;
}

/** Owns descriptors and volume leases in a scope for each admitted file. */
export const createFileHandles = Effect.fn(function* (
  execution: ExecutionContext,
  openFile: (
    location: FilesystemLocation,
    mode: FilesystemOpenMode,
    retained: boolean,
  ) => Effect.Effect<OpenedFilesystemFile, Error, Scope.Scope>,
) {
  const handles = new Map<string, HandleEntry>();
  let retained = 0;
  let disposed = false;

  // Include opening and closing handles until their scopes have actually closed.
  function admit(owner?: HandleOwner): [string, HandleEntry] {
    if (disposed) throw new Error("Filesystem handles are closed");
    if (owner && retained >= 1024)
      throw new Error("Too many open filesystem handles");
    const id = randomUUID();
    const entry: HandleEntry = {
      owner,
      retained: owner !== undefined,
      scope: Scope.makeUnsafe(),
      opened: Deferred.makeUnsafe(),
      closed: Deferred.makeUnsafe(),
      idle: Latch.makeUnsafe(),
      active: 1,
      closing: false,
    };
    handles.set(id, entry);
    if (entry.retained) retained++;
    return [id, entry];
  }

  function releaseUse(entry: HandleEntry) {
    return Effect.sync(() => {
      if (--entry.active === 0) entry.idle.openUnsafe();
    });
  }

  const open = Effect.fn(function* (
    location: FilesystemLocation,
    mode: FilesystemOpenMode = "read",
  ): Effect.fn.Return<FilesystemHandle, Error> {
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const [id, entry] = yield* Effect.try({
          try: () => admit(requireCaller()),
          catch: asError,
        });
        return yield* restore(
          Deferred.into(
            Scope.provide(openFile(location, mode, true), entry.scope),
            entry.opened,
          ).pipe(
            Effect.andThen(Deferred.await(entry.opened)),
            Effect.flatMap(() =>
              entry.closing
                ? Effect.fail(new Error("Filesystem handle owner has closed"))
                : Effect.succeed({ handleId: id }),
            ),
          ),
        ).pipe(
          Effect.ensuring(releaseUse(entry)),
          Effect.onExit((exit) =>
            Exit.isFailure(exit) ? closeEntry(id, entry) : Effect.void,
          ),
        );
      }),
    );
  });

  function use<A, E>(
    source: FilesystemSource,
    operation: (file: FileHandle) => Effect.Effect<A, E>,
  ): Effect.Effect<A, E | Error> {
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if (!("handleId" in source)) {
          const [id, entry] = yield* Effect.try({
            try: () => admit(),
            catch: asError,
          });
          return yield* restore(
            Scope.provide(
              Effect.flatMap(openFile(source, "read", false), (opened) =>
                opened.use(operation),
              ),
              entry.scope,
            ),
          ).pipe(
            Effect.ensuring(
              Effect.andThen(releaseUse(entry), closeEntry(id, entry)),
            ),
          );
        }
        const entry = yield* Effect.try({
          try: () => {
            if (disposed) throw new Error("Filesystem handles are closed");
            const entry = requireHandle(source);
            entry.active++;
            entry.idle.closeUnsafe();
            return entry;
          },
          catch: asError,
        });
        return yield* restore(
          Effect.flatMap(Deferred.await(entry.opened), (opened) =>
            opened.use(operation),
          ),
        ).pipe(Effect.ensuring(releaseUse(entry)));
      }),
    );
  }

  const close = (handle: FilesystemHandle) =>
    Effect.flatMap(
      Effect.try({ try: () => requireHandle(handle), catch: asError }),
      (entry) => closeEntry(handle.handleId, entry),
    );

  function closeOwner(owner: {
    appId?: string;
    webContentsId?: number;
    sessionId?: string;
  }) {
    return Effect.suspend(() => {
      const entries = [...handles].filter(
        ([, entry]) =>
          entry.retained &&
          (owner.appId === undefined || entry.owner?.appId === owner.appId) &&
          (owner.sessionId === undefined ||
            entry.owner?.sessionId === owner.sessionId) &&
          (owner.webContentsId === undefined ||
            entry.owner?.webContentsId === owner.webContentsId),
      );
      // Revoke every selected handle before waiting for any native I/O.
      const closing = entries.map(([id, entry]) => beginClose(id, entry));
      return Effect.forEach(closing, (work) => work, {
        concurrency: "unbounded",
        discard: true,
      });
    }).pipe(Effect.uninterruptible);
  }

  function dispose() {
    return Effect.suspend(() => {
      disposed = true;
      return Effect.forEach(
        [...handles],
        ([id, entry]) => closeEntry(id, entry),
        { concurrency: "unbounded", discard: true },
      );
    }).pipe(Effect.uninterruptible);
  }

  function closeEntry(id: string, entry: HandleEntry): Effect.Effect<void> {
    return Effect.suspend(() => beginClose(id, entry)).pipe(
      Effect.uninterruptible,
    );
  }

  function beginClose(id: string, entry: HandleEntry): Effect.Effect<void> {
    if (entry.closing) return Deferred.await(entry.closed);
    entry.closing = true;
    return Deferred.into(
      Effect.andThen(
        entry.idle.await,
        Scope.close(entry.scope, Exit.void),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            handles.delete(id);
            if (entry.retained) retained--;
          }),
        ),
      ),
      entry.closed,
    ).pipe(
      Effect.andThen(Deferred.await(entry.closed)),
      Effect.uninterruptible,
    );
  }

  function requireCaller(): HandleOwner {
    const caller = execution.get();
    if (!caller?.appId || !caller.principal)
      throw new Error("Caller has no filesystem app authority");
    return {
      appId: caller.appId,
      sessionId: caller.sessionId,
      principalKind: caller.principal.kind,
      username:
        caller.principal.kind === "user"
          ? caller.principal.profile.username
          : undefined,
      webContentsId: caller.webContentsId,
    };
  }

  function requireHandle(handle: FilesystemHandle): HandleEntry {
    const caller = requireCaller();
    const entry = handles.get(handle.handleId);
    const owner = entry?.retained && !entry.closing ? entry.owner : undefined;
    if (
      !entry ||
      !owner ||
      caller.appId !== owner.appId ||
      caller.sessionId !== owner.sessionId ||
      caller.principalKind !== owner.principalKind ||
      caller.username !== owner.username
    )
      throw new Error("Filesystem handle is unavailable to this caller");
    return entry;
  }
  yield* Effect.addFinalizer(dispose);
  return { open, use, close, closeOwner, dispose };
});

/** Whole-file reads use explicit positions so repeated and concurrent reads start at zero. */
export const readOpenedFile = Effect.fn(function* (file: FileHandle) {
  const chunks: Buffer[] = [];
  let position = 0;
  while (true) {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const { bytesRead } = yield* fromPromise(() =>
      file.read(buffer, 0, buffer.length, position),
    );
    if (bytesRead === 0) return Buffer.concat(chunks, position);
    chunks.push(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
});
