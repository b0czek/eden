import {
  operationTask,
  type OperationTask,
  type OperationReporter,
} from "../operations/OperationTask";
import { AsyncLocalStorage } from "node:async_hooks";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  FilesystemVolume,
  FilesystemVolumeRegistration,
} from "@edenapp/types";
import { inject, injectable, Lifecycle, scoped } from "tsyringe";
import type { EdenVolumeOptions } from "../api/ControlPlaneApi";
import { EdenEmitter, EdenNamespace, IPCBridge } from "../ipc";

interface VolumeEvents {
  "volumes-changed": { volumes: FilesystemVolume[] };
}

interface MountedVolume {
  info: FilesystemVolume;
  rootPath: string;
  device: number;
  inode: number;
  eject?: () => Promise<void>;
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

@scoped(Lifecycle.ContainerScoped)
@injectable()
@EdenNamespace("fs")
export class VolumeManager extends EdenEmitter<VolumeEvents> {
  private readonly mounted = new Map<string, MountedVolume>();
  private readonly operationContext = new AsyncLocalStorage<
    Map<string, VolumeLease>
  >();
  private disposed = false;
  private readonly home: FilesystemVolume = {
    id: "home",
    label: "Home",
    kind: "local",
    readOnly: false,
    supportsWatch: true,
    supportsEject: false,
    state: "ready",
  };

  constructor(@inject(IPCBridge) ipcBridge: IPCBridge) {
    super(ipcBridge);
  }

  list(): FilesystemVolume[] {
    return structuredClone([
      this.home,
      ...Array.from(this.mounted.values(), (entry) => entry.info),
    ]);
  }

  get(id: string): FilesystemVolume {
    if (this.disposed) throw new Error("Filesystem volumes are disposed");
    const info = id === "home" ? this.home : this.mounted.get(id)?.info;
    if (!info) throw new Error(`Filesystem volume '${id}' is unavailable`);
    return { ...info };
  }

  async register(
    input: FilesystemVolumeRegistration,
    options: EdenVolumeOptions = {},
  ): Promise<FilesystemVolume> {
    if (
      !input ||
      typeof input.id !== "string" ||
      !input.id.trim() ||
      input.id === "home"
    ) {
      throw new Error("Volume ID must be nonempty and cannot be 'home'");
    }
    if (typeof input.label !== "string" || !input.label.trim())
      throw new Error("Volume label is required");
    if (!["local", "removable", "network"].includes(input.kind))
      throw new Error("Invalid volume kind");
    if (
      typeof input.rootPath !== "string" ||
      !path.isAbsolute(input.rootPath)
    ) {
      throw new Error(
        "Volume root must be an absolute path to an existing directory",
      );
    }
    for (const value of [input.readOnly, input.supportsWatch]) {
      if (value !== undefined && typeof value !== "boolean")
        throw new TypeError("Volume capabilities must be booleans");
    }
    if (options.eject !== undefined && typeof options.eject !== "function")
      throw new TypeError("Volume eject operation must be a function");
    const eject = options.eject?.bind(options);
    const rootPath = await fs.realpath(input.rootPath);
    const stats = await fs.stat(rootPath);
    if (!stats.isDirectory())
      throw new Error("Volume root must be a directory");
    if (this.disposed) throw new Error("Filesystem volumes are disposed");
    if (this.mounted.has(input.id))
      throw new Error(`Volume '${input.id}' is already registered`);
    const info: FilesystemVolume = {
      id: input.id,
      label: input.label,
      kind: input.kind,
      readOnly: input.readOnly ?? false,
      supportsWatch: input.supportsWatch ?? input.kind !== "network",
      supportsEject: eject !== undefined,
      state: "ready",
    };
    this.mounted.set(input.id, {
      info,
      rootPath,
      device: stats.dev,
      inode: stats.ino,
      eject,
      activeOperations: new Set(),
    });
    this.notify("volumes-changed", { volumes: this.list() });
    return { ...info };
  }

  unregister(id: string): boolean {
    if (id === "home")
      throw new Error("The home volume cannot be unregistered");
    if (!this.mounted.delete(id)) return false;
    this.notify("volumes-changed", { volumes: this.list() });
    return true;
  }

  /** Reserve removal synchronously so newly submitted I/O is rejected. */
  prepareEject(id: string): OperationTask<void> {
    this.get(id);
    if (id === "home") throw new Error("The home volume cannot be ejected");
    const entry = this.mounted.get(id);
    if (!entry) throw new Error(`Filesystem volume '${id}' is unavailable`);
    const operation = entry.eject;
    if (!operation)
      throw new Error(`Filesystem volume '${id}' does not support eject`);
    const lease = this.operationContext.getStore()?.get(id);
    if (lease?.entry === entry && !lease.released)
      throw new Error(
        "Cannot remove a volume from an active filesystem operation",
      );
    if (entry.removal) {
      const removal = entry.removal;
      return operationTask(async (reporter) => {
        reporter.update("waiting-for-eject");
        await removal;
      });
    }
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const removal = new Promise<void>((complete, fail) => {
      resolve = complete;
      reject = fail;
    });
    // Reservation may precede execution; attach an owned rejection observer.
    void removal.catch(() => undefined);
    entry.removal = removal;
    entry.info.state = "ejecting";
    this.notify("volumes-changed", { volumes: this.list() });
    let started = false;
    return operationTask(async (reporter) => {
      if (started) {
        await removal;
        return;
      }
      started = true;
      try {
        reporter.update("draining-volume-io");
        await Promise.all(entry.activeOperations);
        await this.assertMounted(id, entry);
        if (this.disposed || this.mounted.get(id) !== entry)
          throw new Error(`Filesystem volume '${id}' is unavailable`);
        reporter.update("host-eject");
        await operation();
        if (this.mounted.get(id) === entry) this.unregister(id);
        resolve();
      } catch (error) {
        if (!this.disposed && this.mounted.get(id) === entry) {
          entry.removal = undefined;
          entry.info.state = "ready";
          this.notify("volumes-changed", { volumes: this.list() });
        }
        reject(error);
      }
      await removal;
    });
  }

  async eject(id: string): Promise<void> {
    await this.prepareEject(id).run({ update: () => undefined });
  }

  private admit(ids: string[]): {
    context: Map<string, VolumeLease>;
    release: () => void;
  } {
    const context = new Map(this.operationContext.getStore());
    const entries = new Map<string, MountedVolume>();
    for (const id of new Set(ids)) {
      this.get(id);
      if (id === "home") continue;
      const entry = this.mounted.get(id);
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
  prepareOperation<R>(
    ids: string[],
    run: (reporter: OperationReporter) => Promise<R>,
  ): OperationTask<R> {
    const admitted = this.admit(ids);
    let started = false;
    return operationTask(async (reporter) => {
      if (started) throw new Error("Volume operation has already started");
      started = true;
      try {
        return await this.operationContext.run(admitted.context, () =>
          run(reporter),
        );
      } finally {
        admitted.release();
      }
    });
  }

  /** Admit awaited filesystem I/O and let removal wait for it to finish. */
  async withVolumes<T>(ids: string[], operation: () => Promise<T>): Promise<T> {
    const admitted = this.admit(ids);
    try {
      return await this.operationContext.run(admitted.context, operation);
    } finally {
      admitted.release();
    }
  }

  private async assertMounted(id: string, entry: MountedVolume): Promise<void> {
    const assertRegistered = () => {
      if (this.disposed || this.mounted.get(id) !== entry)
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

  getRoot(id: string): VolumeRoot | undefined {
    this.get(id);
    if (id === "home") return undefined;
    const entry = this.mounted.get(id);
    if (!entry) throw new Error(`Filesystem volume '${id}' is unavailable`);
    const lease = this.operationContext.getStore()?.get(id);
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
        await this.assertMounted(id, entry);
        assertAccessible();
      },
    };
  }

  override dispose(): void {
    this.disposed = true;
    this.mounted.clear();
    super.dispose();
  }
}
