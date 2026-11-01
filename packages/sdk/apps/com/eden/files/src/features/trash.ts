import * as eden from "@edenapp/client";
import { type FileItem, getParentPath, joinPath } from "@edenapp/files-core";
import type { FilesystemLocation } from "@edenapp/types";
import { t } from "../i18n";
import { isSameOrDescendantPath, normalizeVirtualPath } from "./fileTransfers";

export const TRASH_DIRECTORY = ".eden-trash";

export interface TrashEntry {
  directory: FilesystemLocation;
  content: FilesystemLocation;
  original: FilesystemLocation;
  name: string;
  deletedAt: string;
  isDirectory: boolean;
  isFile: boolean;
  size: number;
}

type Move = (
  from: FilesystemLocation,
  to: FilesystemLocation,
) => Promise<unknown>;
type Remove = (location: FilesystemLocation) => Promise<unknown>;

interface TrashMetadata {
  original: FilesystemLocation;
  name: string;
  deletedAt: string;
}

function isMetadata(value: unknown): value is TrashMetadata {
  if (!value || typeof value !== "object") return false;
  if (
    !("original" in value) ||
    !value.original ||
    typeof value.original !== "object"
  )
    return false;
  const original = value.original;
  return (
    "volume" in original &&
    typeof original.volume === "string" &&
    original.volume.length > 0 &&
    "path" in original &&
    typeof original.path === "string" &&
    original.path !== "/" &&
    !original.path.includes("\0") &&
    normalizeVirtualPath(original.path) === original.path &&
    "name" in value &&
    typeof value.name === "string" &&
    value.name === original.path.split("/").pop() &&
    "deletedAt" in value &&
    typeof value.deletedAt === "string" &&
    Number.isFinite(Date.parse(value.deletedAt))
  );
}

export function getTrashRootForPath(
  location: FilesystemLocation,
): FilesystemLocation | undefined {
  if (location.volume !== "home") return undefined;
  const parts = normalizeVirtualPath(location.path).split("/");
  const index = parts.indexOf(TRASH_DIRECTORY);
  if (index < 0) return undefined;
  return { volume: location.volume, path: parts.slice(0, index + 1).join("/") };
}

export function isTrashFolder(location: FilesystemLocation): boolean {
  return getTrashRootForPath(location)?.path === location.path;
}

const trashRoot = async (volume: string): Promise<FilesystemLocation> => {
  if (volume !== "home") throw new Error(t("files.volumeNoTrash"));
  const scope = await eden.fs.accessScope(volume);
  return { volume, path: joinPath(scope.path, TRASH_DIRECTORY) };
};

export async function moveToTrash(item: FileItem, move: Move) {
  const root = await trashRoot(item.location.volume);
  if (
    item.location.path === "/" ||
    getTrashRootForPath(item.location) ||
    isSameOrDescendantPath(item.location.path, root.path)
  ) {
    throw new Error(t("files.errors.trashStorage"));
  }
  const metadata: TrashMetadata = {
    original: item.location,
    name: item.name,
    deletedAt: new Date().toISOString(),
  };
  if (!isMetadata(metadata)) throw new Error(t("files.errors.trashMetadata"));
  // Save the original location before moving anything. Each entry has its own
  // directory so equal names and simultaneous Files windows cannot collide.
  const directory = { ...root, path: joinPath(root.path, crypto.randomUUID()) };
  await eden.fs.mkdir(directory);
  await eden.fs.write(
    { ...directory, path: joinPath(directory.path, "metadata.json") },
    JSON.stringify(metadata),
  );
  await move(item.location, {
    ...directory,
    path: joinPath(directory.path, "content"),
  });
}

async function readTrashRoot(root: FilesystemLocation) {
  const entries: TrashEntry[] = [];
  const errors: string[] = [];
  const directories: FilesystemLocation[] = [];
  if (!(await eden.fs.exists(root))) return { entries, errors, directories };
  directories.push(root);
  for (const id of await eden.fs.readdir(root)) {
    const directory = { ...root, path: joinPath(root.path, id) };
    const content = { ...root, path: joinPath(directory.path, "content") };
    try {
      directories.push(directory);
      // An interrupted or failed move can leave metadata with no content.
      if (!(await eden.fs.readdir(directory)).includes("content")) continue;
      const metadata: unknown = JSON.parse(
        await eden.fs.read({
          ...root,
          path: joinPath(directory.path, "metadata.json"),
        }),
      );
      if (
        !isMetadata(metadata) ||
        metadata.original.volume !== root.volume ||
        !isSameOrDescendantPath(
          getParentPath(root.path),
          metadata.original.path,
        ) ||
        getTrashRootForPath(metadata.original) ||
        isSameOrDescendantPath(metadata.original.path, root.path)
      ) {
        throw new Error(t("files.errors.trashMetadata"));
      }
      const stats = await eden.fs.lstat(content);
      entries.push({
        directory,
        content,
        original: {
          volume: metadata.original.volume,
          path: metadata.original.path,
        },
        name: metadata.name,
        deletedAt: metadata.deletedAt,
        isDirectory: stats.isDirectory,
        isFile: stats.isFile,
        size: stats.size,
      });
    } catch (error) {
      errors.push(
        `${root.volume}:${directory.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { entries, errors, directories };
}

export async function readTrash(root: FilesystemLocation) {
  const result = await readTrashRoot(root);
  return {
    ...result,
    entries: result.entries.sort((a, b) =>
      b.deletedAt.localeCompare(a.deletedAt),
    ),
    directories: [
      { ...root, path: getParentPath(root.path) },
      ...result.directories,
    ],
  };
}

export async function restoreTrashEntry(
  entry: TrashEntry,
  move: Move,
  remove: Remove,
  destination = entry.original,
) {
  if (await eden.fs.exists(destination)) {
    throw new Error(t("files.errors.restoreConflict"));
  }
  await eden.fs.mkdir({
    ...destination,
    path: getParentPath(destination.path),
  });
  // Native rename refuses an existing destination, including dangling symlinks.
  await move(entry.content, destination);
  await remove(entry.directory);
}
