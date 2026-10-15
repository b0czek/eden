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
export class FilesystemHandles {
  private readonly handles = new Map<string, HandleEntry>();
  private readonly closing = new Set<Promise<void>>();
  private readonly oneShots = new Set<Promise<unknown>>();
  private disposed = false;

  constructor(
    private readonly execution: ExecutionContext,
    private readonly openFile: (
      location: FilesystemLocation,
      mode: FilesystemOpenMode,
      retained: boolean,
    ) => Promise<OpenedFilesystemFile>,
  ) {}

  async open(
    location: FilesystemLocation,
    mode: FilesystemOpenMode = "read",
  ): Promise<FilesystemHandle> {
    if (this.disposed) throw new Error("Filesystem handles are closed");
    const owner = this.requireCaller();
    if (this.handles.size + this.closing.size >= 1024)
      throw new Error("Too many open filesystem handles");
    const handle = { handleId: randomUUID() };
    const entry: HandleEntry = {
      owner,
      opened: this.openFile(location, mode, true),
      operations: new Set(),
    };
    this.handles.set(handle.handleId, entry);
    try {
      await entry.opened;
      if (this.handles.get(handle.handleId) !== entry)
        throw new Error("Filesystem handle owner has closed");
      return handle;
    } catch (error) {
      if (this.handles.get(handle.handleId) === entry)
        await this.closeEntry(handle.handleId, entry);
      throw error;
    }
  }

  async use<T>(
    source: FilesystemSource,
    operation: (file: FileHandle) => Promise<T>,
  ): Promise<T> {
    if (this.disposed) throw new Error("Filesystem handles are closed");
    if (!("handleId" in source)) {
      const task = (async () => {
        const opened = await this.openFile(source, "read", false);
        try {
          return await opened.use(operation);
        } finally {
          await opened.close();
        }
      })();
      this.oneShots.add(task);
      try {
        return await task;
      } finally {
        this.oneShots.delete(task);
      }
    }
    const entry = this.requireHandle(source);
    const task = entry.opened.then((opened) => opened.use(operation));
    entry.operations.add(task);
    try {
      return await task;
    } finally {
      entry.operations.delete(task);
    }
  }

  close(handle: FilesystemHandle): Promise<void> {
    return this.closeEntry(handle.handleId, this.requireHandle(handle));
  }

  async closeOwner(owner: {
    appId?: string;
    webContentsId?: number;
    sessionId?: string;
  }): Promise<void> {
    await Promise.all(
      [...this.handles]
        .filter(
          ([, entry]) =>
            (owner.appId === undefined || entry.owner.appId === owner.appId) &&
            (owner.sessionId === undefined ||
              entry.owner.sessionId === owner.sessionId) &&
            (owner.webContentsId === undefined ||
              entry.owner.webContentsId === owner.webContentsId),
        )
        .map(([id, entry]) => this.closeEntry(id, entry)),
    );
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.closeOwner({});
    await Promise.all([...this.closing]);
    await Promise.allSettled([...this.oneShots]);
  }

  private closeEntry(id: string, entry: HandleEntry): Promise<void> {
    this.handles.delete(id);
    const closing = (async () => {
      // Failed opens release their own resources.
      const opened = await entry.opened.catch(() => undefined);
      if (!opened) return;
      await Promise.allSettled([...entry.operations]);
      await opened.close();
    })();
    this.closing.add(closing);
    void closing.then(
      () => this.closing.delete(closing),
      () => this.closing.delete(closing),
    );
    return closing;
  }

  private requireCaller(): HandleOwner {
    const caller = this.execution.get();
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

  private requireHandle(handle: FilesystemHandle): HandleEntry {
    const caller = this.requireCaller();
    const entry = this.handles.get(handle.handleId);
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
