import * as path from "node:path";

/** Fixed folders that Eden keeps under its data directory. */
export interface DataLayout {
  dataDirectory: string;
  /** Backs the Home volume; the only folder that apps can address. */
  homeDirectory: string;
  appsDirectory: string;
  /** System databases and configuration that apps cannot address. */
  systemDirectory: string;
  /** Holds Home items moved to Trash; shares a filesystem with Home by default. */
  trashDirectory: string;
}

export function resolveDataLayout(dataDirectory: string): DataLayout {
  const root = path.resolve(dataDirectory);
  return {
    dataDirectory: root,
    homeDirectory: path.join(root, "home"),
    appsDirectory: path.join(root, "apps"),
    systemDirectory: path.join(root, "system"),
    trashDirectory: path.join(root, "trash"),
  };
}
