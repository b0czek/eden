import { randomUUID } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import type {
  FilesystemHandle,
  FilesystemLocation,
  FilesystemOpenMode,
  FilesystemSource,
} from "@edenapp/types";
import type {
  EffectivePrincipal,
  ExecutionContext,
} from "../execution/ExecutionContext";

export interface OpenedFilesystemFile {
  use<T>(operation: (file: FileHandle) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

interface HandleOwner {
  appId: string;
  sessionId?: string;
  principalKind: EffectivePrincipal["kind"];
  username?: string;
  webContentsId?: number;
}

interface HandleEntry {
  owner: HandleOwner;
  opened: Promise<OpenedFilesystemFile>;
  operations: Set<Promise<unknown>>;
}

/** Owns descriptors and their admission until close or owner teardown. */
export function createFilesystemHandles(
  execution: ExecutionContext,
  openFile: (
    location: FilesystemLocation,
    mode: FilesystemOpenMode,
    retained: boolean,
  ) => Promise<OpenedFilesystemFile>,
) {
  const handles = new Map<string, HandleEntry>();
  const pendingCloses = new Set<Promise<void>>();
  const oneShots = new Set<Promise<unknown>>();
  let disposed = false;

  async function open(
    location: FilesystemLocation,
    mode: FilesystemOpenMode = "read",
  ): Promise<FilesystemHandle> {
    if (disposed) throw new Error("Filesystem handles are closed");
    const owner = requireCaller();
    if (handles.size + pendingCloses.size >= 1024)
      throw new Error("Too many open filesystem handles");
    const handle = { handleId: randomUUID() };
    const entry: HandleEntry = {
      owner,
      opened: openFile(location, mode, true),
      operations: new Set(),
    };
    handles.set(handle.handleId, entry);
    try {
      await entry.opened;
      if (handles.get(handle.handleId) !== entry)
        throw new Error("Filesystem handle owner has closed");
      return handle;
    } catch (error) {
      if (handles.get(handle.handleId) === entry)
        await closeEntry(handle.handleId, entry);
      throw error;
    }
  }

  async function use<T>(
    source: FilesystemSource,
    operation: (file: FileHandle) => Promise<T>,
  ): Promise<T> {
    if (disposed) throw new Error("Filesystem handles are closed");
    if (!("handleId" in source)) {
      const task = (async () => {
        const opened = await openFile(source, "read", false);
        try {
          return await opened.use(operation);
        } finally {
          await opened.close();
        }
      })();
      oneShots.add(task);
      try {
        return await task;
      } finally {
        oneShots.delete(task);
      }
    }
    const entry = requireHandle(source);
    const task = entry.opened.then((opened) => opened.use(operation));
    entry.operations.add(task);
    try {
      return await task;
    } finally {
      entry.operations.delete(task);
    }
  }

  function close(handle: FilesystemHandle): Promise<void> {
    return closeEntry(handle.handleId, requireHandle(handle));
  }

  async function closeOwner(owner: {
    appId?: string;
    webContentsId?: number;
    sessionId?: string;
  }): Promise<void> {
    await Promise.all(
      [...handles]
        .filter(
          ([, entry]) =>
            (owner.appId === undefined || entry.owner.appId === owner.appId) &&
            (owner.sessionId === undefined ||
              entry.owner.sessionId === owner.sessionId) &&
            (owner.webContentsId === undefined ||
              entry.owner.webContentsId === owner.webContentsId),
        )
        .map(([id, entry]) => closeEntry(id, entry)),
    );
  }

  async function dispose(): Promise<void> {
    disposed = true;
    await closeOwner({});
    await Promise.all([...pendingCloses]);
    await Promise.allSettled([...oneShots]);
  }

  function closeEntry(id: string, entry: HandleEntry): Promise<void> {
    handles.delete(id);
    const closing = (async () => {
      // Failed opens release their own resources.
      const opened = await entry.opened.catch(() => undefined);
      if (!opened) return;
      await Promise.allSettled([...entry.operations]);
      await opened.close();
    })();
    pendingCloses.add(closing);
    void closing.then(
      () => pendingCloses.delete(closing),
      () => pendingCloses.delete(closing),
    );
    return closing;
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
    const owner = entry?.owner;
    if (
      !owner ||
      caller.appId !== owner.appId ||
      caller.sessionId !== owner.sessionId ||
      caller.principalKind !== owner.principalKind ||
      caller.username !== owner.username
    )
      throw new Error("Filesystem handle is unavailable to this caller");
    return entry;
  }
  return { open, use, close, closeOwner, dispose };
}

/** Whole-file reads use explicit positions so repeated and concurrent reads start at zero. */
export async function readOpenedFile(file: FileHandle): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let position = 0;
  while (true) {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) return Buffer.concat(chunks, position);
    chunks.push(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
}
