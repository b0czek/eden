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
import {
  type OperationReporter,
  type OperationTask,
  operationTask,
} from "../operations/OperationTask";

interface VolumeEvents {
  changed: { volumes: FilesystemVolume[] };
}

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
  release(): void;
}

@scoped(Lifecycle.ContainerScoped)
@injectable()
@EdenNamespace("volume")
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
    if (
      options.ejectGroup !== undefined &&
      (typeof options.ejectGroup !== "string" ||
        !options.ejectGroup.trim() ||
        !options.eject)
    )
      throw new TypeError(
        "An eject group requires a nonempty key and an eject operation",
      );
    const eject = options.eject?.bind(options);
    const rootPath = await fs.realpath(input.rootPath);
    const stats = await fs.stat(rootPath);
    if (!stats.isDirectory())
      throw new Error("Volume root must be a directory");
    if (this.disposed) throw new Error("Filesystem volumes are disposed");
    if (this.mounted.has(input.id))
      throw new Error(`Volume '${input.id}' is already registered`);
    if (
      options.ejectGroup &&
      [...this.mounted.values()].some(
        (entry) => entry.ejectGroup === options.ejectGroup && entry.removal,
      )
    )
      throw new Error(
        "Cannot register a volume while its eject group is being removed",
      );
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
      ejectGroup: options.ejectGroup,
      activeOperations: new Set(),
    });
    this.notify("changed", { volumes: this.list() });
    return { ...info };
  }

  unregister(id: string): boolean {
    if (id === "home")
      throw new Error("The home volume cannot be unregistered");
    if (!this.mounted.delete(id)) return false;
    this.notify("changed", { volumes: this.list() });
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
    const group = entry.ejectGroup
      ? [...this.mounted.entries()].filter(
          ([, sibling]) => sibling.ejectGroup === entry.ejectGroup,
        )
      : [[id, entry] as const];
    if (
      group.some(([volumeId, sibling]) => {
        const lease = this.operationContext.getStore()?.get(volumeId);
        return lease?.entry === sibling && !lease.released;
      })
    )
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
    for (const [, sibling] of group) {
      sibling.removal = removal;
      sibling.info.state = "ejecting";
    }
    this.notify("changed", { volumes: this.list() });
    let started = false;
    return operationTask(async (reporter) => {
      if (started) {
        await removal;
        return;
      }
      started = true;
      try {
        reporter.update("draining-volume-io");
        await Promise.all(
          group.flatMap(([, sibling]) => [...sibling.activeOperations]),
        );
        for (const [volumeId, sibling] of group)
          await this.assertMounted(volumeId, sibling);
        reporter.update("host-eject");
        await operation();
        for (const [volumeId, sibling] of group)
          if (this.mounted.get(volumeId) === sibling) this.unregister(volumeId);
        resolve();
      } catch (error) {
        for (const [volumeId, sibling] of group) {
          if (!this.disposed && this.mounted.get(volumeId) === sibling) {
            sibling.removal = undefined;
            sibling.info.state = "ready";
          }
        }
        if (!this.disposed) this.notify("changed", { volumes: this.list() });
        reject(error);
      }
      await removal;
    });
  }

  private admit(
    ids: string[],
    inherit: boolean,
  ): {
    context: Map<string, VolumeLease>;
    release: () => void;
  } {
    const context = new Map(
      inherit ? this.operationContext.getStore() : undefined,
    );
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
    const access = this.acquire(ids, true);
    let started = false;
    return operationTask(async (reporter) => {
      if (started) throw new Error("Volume operation has already started");
      started = true;
      try {
        return await access.run(() => run(reporter));
      } finally {
        access.release();
      }
    });
  }

  /** Admit awaited filesystem I/O and let removal wait for it to finish. */
  async withVolumes<T>(ids: string[], operation: () => Promise<T>): Promise<T> {
    const access = this.acquire(ids, true);
    try {
      return await access.run(operation);
    } finally {
      access.release();
    }
  }

  acquire(ids: string[], inherit = false): VolumeAccess {
    const admitted = this.admit(ids, inherit);
    let released = false;
    return {
      run: (operation) => {
        if (released) throw new Error("Filesystem volume access is closed");
        return this.operationContext.run(admitted.context, operation);
      },
      release: () => {
        if (released) return;
        released = true;
        admitted.release();
      },
    };
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
