import type { FileItem } from "@edenapp/files-core";

export type TransferOperation = "copy" | "move";
export type CollisionAction = "replace" | "keep-both" | "skip";

export interface PendingTransfer {
  operation: TransferOperation;
  items: FileItem[];
}

export interface CollisionDecision {
  action: CollisionAction | "cancel";
  applyToAll: boolean;
}

export type TransferPlan =
  | { kind: "transfer"; targetPath: string }
  | { kind: "keep-both" }
  | { kind: "no-op" }
  | { kind: "invalid"; reason: "self-or-descendant" };

const joinVirtualPath = (...parts: string[]) =>
  parts.join("/").replace(/\/+/g, "/").replace(/\/$/, "") || "/";

export const normalizeVirtualPath = (value: string): string => {
  const segments: string[] = [];
  for (const segment of value.replaceAll("\\", "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join("/")}`;
};

export const isSameOrDescendantPath = (
  parentPath: string,
  candidatePath: string,
): boolean => {
  const parent = normalizeVirtualPath(parentPath);
  const candidate = normalizeVirtualPath(candidatePath);
  return parent === "/"
    ? candidate.startsWith("/")
    : candidate === parent || candidate.startsWith(`${parent}/`);
};

export const planTransfer = (
  item: FileItem,
  destinationDirectory: string,
  operation: TransferOperation,
): TransferPlan => {
  const destination = normalizeVirtualPath(destinationDirectory);
  const source = normalizeVirtualPath(item.path);

  if (item.isDirectory && isSameOrDescendantPath(source, destination)) {
    return { kind: "invalid", reason: "self-or-descendant" };
  }

  const targetPath = joinVirtualPath(destination, item.name);
  if (targetPath === source) {
    return operation === "move" ? { kind: "no-op" } : { kind: "keep-both" };
  }

  return { kind: "transfer", targetPath };
};

export const splitFileName = (name: string) => {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0) return { base: name, extension: "" };
  return {
    base: name.slice(0, dotIndex),
    extension: name.slice(dotIndex),
  };
};

export const createCopyName = (
  item: Pick<FileItem, "name" | "isFile">,
  copySuffix: string,
  copyIndex: number,
): string => {
  const suffix =
    copyIndex === 1 ? `-${copySuffix}` : `-${copySuffix}-${copyIndex}`;
  if (!item.isFile) return `${item.name}${suffix}`;
  const { base, extension } = splitFileName(item.name);
  return `${base}${suffix}${extension}`;
};

export const findKeepBothPath = async (
  item: Pick<FileItem, "name" | "isFile">,
  destinationDirectory: string,
  copySuffix: string,
  pathExists: (path: string) => Promise<boolean>,
): Promise<string> => {
  let copyIndex = 1;
  while (true) {
    const candidate = joinVirtualPath(
      destinationDirectory,
      createCopyName(item, copySuffix, copyIndex),
    );
    if (!(await pathExists(candidate))) return candidate;
    copyIndex += 1;
  }
};

export const rememberCollisionAction = (
  remembered: CollisionAction | undefined,
  decision: CollisionDecision,
): CollisionAction | undefined => {
  if (decision.action === "cancel" || !decision.applyToAll) return remembered;
  return decision.action;
};
