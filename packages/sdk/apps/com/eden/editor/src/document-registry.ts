import type {
  EditorDocumentHandler,
  EditorDocumentHandlerContributionMetadata,
  EditorDocumentHandlerMetadata,
  EditorDocumentHandlerModule,
} from "@edenapp/editor-dlc";
import type { DlcResource } from "@edenapp/types";

const EXTENSION_POINT = "document-handlers";
const handlerIdPattern = /^[a-z0-9][a-z0-9.-]*$/;
const extensionPattern = /^[a-z0-9][a-z0-9+_-]*$/;

export interface EditorDocumentDiagnostic {
  source: string;
  message: string;
}

export interface ResolvedEditorDocumentHandler {
  id: string;
  handler: EditorDocumentHandler;
}

interface DocumentHandlerCandidate extends ResolvedEditorDocumentHandler {
  packageId: string;
  extensions: string[];
}

type DlcModuleImporter = (url: string) => Promise<unknown>;

const importDlcModule: DlcModuleImporter = (url) =>
  import(/* @vite-ignore */ url) as Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRelativePath(value: string): boolean {
  const entry = value.trim();
  return (
    entry.length > 0 &&
    !entry.startsWith("/") &&
    !entry.includes("\\") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(entry) &&
    !entry
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  );
}

function parseMetadata(
  value: unknown,
): EditorDocumentHandlerContributionMetadata | undefined {
  if (
    !isRecord(value) ||
    typeof value.entry !== "string" ||
    !isSafeRelativePath(value.entry) ||
    !Array.isArray(value.handlers) ||
    value.handlers.length === 0
  ) {
    return undefined;
  }

  const handlers: EditorDocumentHandlerMetadata[] = [];
  for (const handler of value.handlers) {
    if (
      !isRecord(handler) ||
      typeof handler.id !== "string" ||
      !handlerIdPattern.test(handler.id) ||
      !Array.isArray(handler.extensions) ||
      handler.extensions.length === 0 ||
      !handler.extensions.every(
        (extension) =>
          typeof extension === "string" && extensionPattern.test(extension),
      ) ||
      new Set(handler.extensions).size !== handler.extensions.length
    ) {
      return undefined;
    }
    handlers.push({
      id: handler.id,
      extensions: handler.extensions,
    });
  }

  return { entry: value.entry.trim(), handlers };
}

function parseHandler(value: unknown): EditorDocumentHandler | undefined {
  if (
    !isRecord(value) ||
    typeof value.open !== "function" ||
    typeof value.save !== "function"
  ) {
    return undefined;
  }
  return value as unknown as EditorDocumentHandler;
}

function parseModule(value: unknown): EditorDocumentHandlerModule | undefined {
  if (!isRecord(value) || !isRecord(value.default)) return undefined;
  if (!isRecord(value.default.handlers)) return undefined;
  return value.default as unknown as EditorDocumentHandlerModule;
}

function extensionFromPath(filePath: string): string {
  const fileName = filePath.split("/").pop() ?? filePath;
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot + 1).toLowerCase();
}

export class EditorDocumentRegistry {
  constructor(
    private readonly handlersByExtension = new Map<
      string,
      ResolvedEditorDocumentHandler
    >(),
  ) {}

  resolve(filePath: string): ResolvedEditorDocumentHandler | undefined {
    return this.handlersByExtension.get(extensionFromPath(filePath));
  }
}

export async function loadEditorDocumentRegistry(
  resources: readonly DlcResource[],
  importer: DlcModuleImporter = importDlcModule,
): Promise<{
  registry: EditorDocumentRegistry;
  diagnostics: EditorDocumentDiagnostic[];
}> {
  const diagnostics: EditorDocumentDiagnostic[] = [];
  const candidates: DocumentHandlerCandidate[] = [];

  for (const resource of resources) {
    const contribution = resource.manifest.contributions.find(
      (item) => item.extensionPoint === EXTENSION_POINT,
    );
    if (!contribution) continue;

    const packageId = resource.manifest.id;
    const metadata = parseMetadata(contribution.metadata);
    if (!metadata) {
      diagnostics.push({
        source: packageId,
        message: "Invalid document-handlers contribution metadata",
      });
      continue;
    }

    let module: EditorDocumentHandlerModule | undefined;
    try {
      module = parseModule(
        await importer(new URL(metadata.entry, resource.rootUrl).href),
      );
    } catch (error) {
      diagnostics.push({
        source: packageId,
        message: `Could not import ${metadata.entry}: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    if (!module) {
      diagnostics.push({
        source: packageId,
        message: "The entry module has an invalid default export",
      });
      continue;
    }

    for (const metadataHandler of metadata.handlers) {
      const source = `${packageId}:${metadataHandler.id}`;
      let handler: EditorDocumentHandler | undefined;
      try {
        handler = parseHandler(module.handlers[metadataHandler.id]);
      } catch (error) {
        diagnostics.push({
          source,
          message: `Could not read document handler export: ${error instanceof Error ? error.message : String(error)}`,
        });
        continue;
      }
      if (!handler) {
        diagnostics.push({
          source,
          message: `Missing or invalid document handler export for ${metadataHandler.id}`,
        });
        continue;
      }
      candidates.push({
        packageId,
        id: metadataHandler.id,
        extensions: metadataHandler.extensions,
        handler,
      });
    }
  }

  const idClaims = new Map<string, DocumentHandlerCandidate[]>();
  for (const candidate of candidates) {
    const claims = idClaims.get(candidate.id) ?? [];
    claims.push(candidate);
    idClaims.set(candidate.id, claims);
  }

  const rejectedIds = new Set<string>();
  for (const [id, claims] of idClaims) {
    if (claims.length < 2) continue;
    rejectedIds.add(id);
    for (const claim of claims) {
      diagnostics.push({
        source: `${claim.packageId}:${id}`,
        message: `Document handler ID ${id} is claimed multiple times`,
      });
    }
  }

  const extensionClaims = new Map<string, DocumentHandlerCandidate[]>();
  for (const candidate of candidates) {
    if (rejectedIds.has(candidate.id)) continue;
    for (const extension of candidate.extensions) {
      const claims = extensionClaims.get(extension) ?? [];
      claims.push(candidate);
      extensionClaims.set(extension, claims);
    }
  }

  const handlersByExtension = new Map<string, ResolvedEditorDocumentHandler>();
  for (const [extension, claims] of extensionClaims) {
    if (claims.length > 1) {
      for (const claim of claims) {
        diagnostics.push({
          source: `${claim.packageId}:${claim.id}`,
          message: `Extension .${extension} is claimed by multiple document handlers`,
        });
      }
      continue;
    }
    const claim = claims[0];
    handlersByExtension.set(extension, {
      id: claim.id,
      handler: claim.handler,
    });
  }

  return {
    registry: new EditorDocumentRegistry(handlersByExtension),
    diagnostics,
  };
}
