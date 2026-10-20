import * as path from "node:path";
import type { FileHandlerConfig, RuntimeAppManifest } from "@edenapp/types";
import type { PackageCatalog } from "../packages/catalog";

type HandlerCatalog = Pick<PackageCatalog, "listApps" | "dlcsForHost">;

export const DIRECTORY_PREFERENCE_KEY = "directory";
export const DIRECTORY_ASSOCIATION_KEY = "file:directory";

export function normalizeExtension(extension: string): string {
  return extension.toLowerCase().replace(/^\./, "");
}

export function normalizeMimeType(mimeType: string): string {
  return mimeType.toLowerCase().split(";")[0].trim();
}

export function getMimePreferenceKey(mimeType: string): string {
  return `file:mime:${normalizeMimeType(mimeType)}`;
}

export function getExtensionPreferenceKey(extension: string): string {
  return `file:ext:${normalizeExtension(extension)}`;
}

export function getPublicPreferenceKey(preferenceKey: string): string {
  if (preferenceKey === DIRECTORY_ASSOCIATION_KEY) {
    return DIRECTORY_PREFERENCE_KEY;
  }
  if (preferenceKey.startsWith("file:mime:")) {
    return `mime:${preferenceKey.slice("file:mime:".length)}`;
  }
  if (preferenceKey.startsWith("file:ext:")) {
    return `ext:${preferenceKey.slice("file:ext:".length)}`;
  }
  return preferenceKey;
}

export function getAssociationKind(preferenceKey: string): string {
  if (preferenceKey === DIRECTORY_ASSOCIATION_KEY) {
    return "file.directory";
  }
  if (preferenceKey.startsWith("file:mime:")) {
    return "file.mime";
  }
  if (preferenceKey.startsWith("file:ext:")) {
    return "file.extension";
  }
  return "file";
}

export function getExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ext.startsWith(".") ? ext.slice(1) : ext;
}

export function getInstalledFileHandlers(
  packageCatalog: HandlerCatalog,
): Array<{
  app: RuntimeAppManifest;
  handler: FileHandlerConfig;
}> {
  const handlers: Array<{
    app: RuntimeAppManifest;
    handler: FileHandlerConfig;
  }> = [];

  for (const app of packageCatalog.listApps({ showHidden: true })) {
    const dlcHandlers = packageCatalog
      .dlcsForHost(app.id)
      .flatMap((dlc) => dlc.fileHandlers ?? []);
    for (const handler of [...(app.fileHandlers ?? []), ...dlcHandlers]) {
      handlers.push({ app, handler });
    }
  }

  return handlers;
}

export function handlerSupportsExtension(
  handler: FileHandlerConfig,
  extension: string,
): boolean {
  return (
    handler.extensions?.some(
      (candidate) => normalizeExtension(candidate) === extension,
    ) ?? false
  );
}

export function getMimeMatchScore(
  handler: FileHandlerConfig,
  mimeType: string,
): number {
  let bestScore = 0;

  for (const candidate of handler.mimeTypes ?? []) {
    const normalizedCandidate = normalizeMimeType(candidate);

    if (normalizedCandidate === mimeType) {
      bestScore = Math.max(bestScore, 8);
      continue;
    }

    if (
      normalizedCandidate.endsWith("/*") &&
      mimeType.startsWith(normalizedCandidate.slice(0, -1))
    ) {
      bestScore = Math.max(bestScore, 6);
    }
  }

  return bestScore;
}

export function getMatchingHandlers(
  packageCatalog: HandlerCatalog,
  criteria: {
    extension?: string;
    mimeType?: string;
    isDirectory?: boolean;
  },
): Array<{
  app: RuntimeAppManifest;
  handler: FileHandlerConfig;
  score: number;
}> {
  const extension = criteria.extension
    ? normalizeExtension(criteria.extension)
    : undefined;
  const mimeType = criteria.mimeType
    ? normalizeMimeType(criteria.mimeType)
    : undefined;

  const matches: Array<{
    app: RuntimeAppManifest;
    handler: FileHandlerConfig;
    score: number;
  }> = [];

  for (const { app, handler } of getInstalledFileHandlers(packageCatalog)) {
    if (criteria.isDirectory) {
      if (!handler.directories) {
        continue;
      }

      matches.push({ app, handler, score: 100 });
      continue;
    }

    let score = 0;

    if (extension && handlerSupportsExtension(handler, extension)) {
      score += 2;
    }

    if (mimeType) {
      score += getMimeMatchScore(handler, mimeType);
    }

    if (score === 0) {
      continue;
    }

    matches.push({ app, handler, score });
  }

  return matches.sort((left, right) => right.score - left.score);
}
