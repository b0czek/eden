import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  FilesystemVolume,
  FilesystemVolumeRegistration,
} from "@edenapp/types";
import { inject, injectable, Lifecycle, scoped } from "tsyringe";
import { EdenEmitter, EdenNamespace, IPCBridge } from "../ipc";

interface VolumeEvents {
  "volumes-changed": { volumes: FilesystemVolume[] };
}

interface MountedVolume {
  info: FilesystemVolume;
  rootPath: string;
  device: number;
  inode: number;
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
  private disposed = false;
  private readonly home: FilesystemVolume = {
    id: "home",
    label: "Home",
    kind: "local",
    readOnly: false,
    supportsWatch: true,
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
    };
    this.mounted.set(input.id, {
      info,
      rootPath,
      device: stats.dev,
      inode: stats.ino,
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

  getRoot(id: string): VolumeRoot | undefined {
    this.get(id);
    if (id === "home") return undefined;
    const entry = this.mounted.get(id);
    if (!entry) throw new Error(`Filesystem volume '${id}' is unavailable`);
    const assertRegistered = () => {
      if (this.disposed || this.mounted.get(id) !== entry)
        throw new Error(`Filesystem volume '${id}' is unavailable`);
    };
    return {
      rootPath: entry.rootPath,
      assertActive: async () => {
        assertRegistered();
        const stats = await fs.stat(entry.rootPath);
        assertRegistered();
        if (
          !stats.isDirectory() ||
          stats.dev !== entry.device ||
          stats.ino !== entry.inode
        ) {
          throw new Error(`Filesystem volume '${id}' mount has changed`);
        }
      },
    };
  }

  override dispose(): void {
    this.disposed = true;
    this.mounted.clear();
    super.dispose();
  }
}
