import * as path from "node:path";

/** Folders that Eden keeps under its data directory, with an optional external Home. */
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

export function resolveDataLayout(
  dataDirectory: string,
  homeDirectory?: string,
): DataLayout {
  const root = path.resolve(dataDirectory);
  const home = homeDirectory
    ? path.resolve(homeDirectory)
    : path.join(root, "home");
  const fromHome = path.relative(home, root);
  const outsideHome =
    fromHome === ".." ||
    fromHome.startsWith(`..${path.sep}`) ||
    path.isAbsolute(fromHome);
  if (!outsideHome) {
    throw new Error(
      `homeDirectory '${home}' must not contain dataDirectory '${root}'`,
    );
  }
  return {
    dataDirectory: root,
    homeDirectory: home,
    appsDirectory: path.join(root, "apps"),
    systemDirectory: path.join(root, "system"),
    trashDirectory: path.join(root, "trash"),
  };
}
