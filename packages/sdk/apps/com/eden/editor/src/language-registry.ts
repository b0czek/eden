import type {
  EditorHighlighterContributionMetadata,
  EditorHighlighterModule,
  EditorHighlightStyle,
  EditorLanguageMetadata,
  EditorLanguageName,
  EditorLineHighlighter,
} from "@edenapp/editor-dlc";
import type { DlcResource } from "@edenapp/types";
import { extensionToLanguage, getLanguageFromPath } from "./types";

const EXTENSION_POINT = "language-highlighters";
const languageIdPattern = /^[a-z0-9][a-z0-9.-]*$/;
const extensionPattern = /^[a-z0-9][a-z0-9+_-]*$/;
const highlightStyles = new Set<EditorHighlightStyle>([
  "plain",
  "comment",
  "keyword",
  "operator",
  "number",
  "string",
  "variable",
  "property",
  "type",
  "function",
  "label",
  "heading",
  "link",
  "meta",
  "invalid",
]);

export interface EditorLanguageDiagnostic {
  source: string;
  message: string;
}

export interface ResolvedEditorLanguage {
  id: string;
  name: EditorLanguageName;
  highlighter?: EditorLineHighlighter;
}

interface LanguageCandidate extends ResolvedEditorLanguage {
  packageId: string;
  extensions: string[];
}

type DlcModuleImporter = (url: string) => Promise<unknown>;

const importDlcModule: DlcModuleImporter = (url) =>
  import(/* @vite-ignore */ url) as Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLanguageName(value: unknown): value is EditorLanguageName {
  if (typeof value === "string") return value.trim().length > 0;
  return (
    isRecord(value) &&
    Object.keys(value).length > 0 &&
    Object.values(value).every(
      (entry) => typeof entry === "string" && entry.trim().length > 0,
    )
  );
}

function parseMetadata(
  value: unknown,
): EditorHighlighterContributionMetadata | undefined {
  if (!isRecord(value) || typeof value.entry !== "string") return undefined;
  const entry = value.entry.trim();
  if (
    !entry ||
    entry.startsWith("/") ||
    entry.includes("\\") ||
    /^[a-z][a-z0-9+.-]*:/i.test(entry) ||
    entry
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return undefined;
  }

  if (!Array.isArray(value.languages) || value.languages.length === 0) {
    return undefined;
  }

  const languages: EditorLanguageMetadata[] = [];
  for (const language of value.languages) {
    if (
      !isRecord(language) ||
      typeof language.id !== "string" ||
      !languageIdPattern.test(language.id) ||
      !isLanguageName(language.name) ||
      !Array.isArray(language.extensions) ||
      language.extensions.length === 0 ||
      !language.extensions.every(
        (extension) =>
          typeof extension === "string" && extensionPattern.test(extension),
      ) ||
      new Set(language.extensions).size !== language.extensions.length
    ) {
      return undefined;
    }
    languages.push({
      id: language.id,
      name: language.name,
      extensions: language.extensions,
    });
  }

  return { entry, languages };
}

function parseHighlighter(value: unknown): EditorLineHighlighter | undefined {
  if (!isRecord(value) || typeof value.highlightLine !== "function") {
    return undefined;
  }
  if (
    !isRecord(value.tokenStyles) ||
    Object.keys(value.tokenStyles).length === 0
  ) {
    return undefined;
  }
  if (
    !Object.values(value.tokenStyles).every(
      (style) =>
        typeof style === "string" &&
        highlightStyles.has(style as EditorHighlightStyle),
    )
  ) {
    return undefined;
  }
  return value as unknown as EditorLineHighlighter;
}

function parseModule(value: unknown): EditorHighlighterModule | undefined {
  if (!isRecord(value) || !isRecord(value.default)) return undefined;
  const highlighters = value.default.highlighters;
  if (!isRecord(highlighters)) return undefined;
  return value.default as unknown as EditorHighlighterModule;
}

function extensionFromPath(filePath: string): string {
  const fileName = filePath.split("/").pop() ?? filePath;
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot + 1).toLowerCase();
}

export function localizedLanguageName(
  name: EditorLanguageName,
  activeLocale: string,
): string {
  if (typeof name === "string") return name;
  return name[activeLocale] ?? name.en ?? Object.values(name)[0] ?? "";
}

export class EditorLanguageRegistry {
  constructor(
    private readonly customByExtension = new Map<
      string,
      ResolvedEditorLanguage
    >(),
  ) {}

  resolve(filePath: string): ResolvedEditorLanguage {
    const custom = this.customByExtension.get(extensionFromPath(filePath));
    if (custom) return custom;
    const id = getLanguageFromPath(filePath);
    return { id, name: id };
  }
}

export async function loadEditorLanguageRegistry(
  resources: readonly DlcResource[],
  importer: DlcModuleImporter = importDlcModule,
): Promise<{
  registry: EditorLanguageRegistry;
  diagnostics: EditorLanguageDiagnostic[];
}> {
  const diagnostics: EditorLanguageDiagnostic[] = [];
  const candidates: LanguageCandidate[] = [];

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
        message: "Invalid language-highlighters contribution metadata",
      });
      continue;
    }

    let module: EditorHighlighterModule | undefined;
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

    for (const language of metadata.languages) {
      const source = `${packageId}:${language.id}`;
      let highlighter: EditorLineHighlighter | undefined;
      try {
        highlighter = parseHighlighter(module.highlighters[language.id]);
      } catch (error) {
        diagnostics.push({
          source,
          message: `Could not read highlighter export: ${error instanceof Error ? error.message : String(error)}`,
        });
        continue;
      }
      if (!highlighter) {
        diagnostics.push({
          source,
          message: `Missing or invalid highlighter export for ${language.id}`,
        });
        continue;
      }
      candidates.push({
        packageId,
        id: language.id,
        name: language.name,
        extensions: language.extensions,
        highlighter,
      });
    }
  }

  const builtInIds = new Set(Object.values(extensionToLanguage));
  const idClaims = new Map<string, LanguageCandidate[]>();
  for (const candidate of candidates) {
    const claims = idClaims.get(candidate.id) ?? [];
    claims.push(candidate);
    idClaims.set(candidate.id, claims);
  }

  const rejectedIds = new Set<string>();
  for (const [id, claims] of idClaims) {
    if (builtInIds.has(id) || claims.length > 1) {
      rejectedIds.add(id);
      for (const claim of claims) {
        diagnostics.push({
          source: `${claim.packageId}:${id}`,
          message: `Language ID ${id} is already claimed`,
        });
      }
    }
  }

  const extensionClaims = new Map<string, LanguageCandidate[]>();
  for (const candidate of candidates) {
    if (rejectedIds.has(candidate.id)) continue;
    for (const extension of candidate.extensions) {
      if (Object.hasOwn(extensionToLanguage, extension)) {
        diagnostics.push({
          source: `${candidate.packageId}:${candidate.id}`,
          message: `Extension .${extension} is provided by a built-in language`,
        });
        continue;
      }
      const claims = extensionClaims.get(extension) ?? [];
      claims.push(candidate);
      extensionClaims.set(extension, claims);
    }
  }

  const customByExtension = new Map<string, ResolvedEditorLanguage>();
  for (const [extension, claims] of extensionClaims) {
    if (claims.length > 1) {
      for (const claim of claims) {
        diagnostics.push({
          source: `${claim.packageId}:${claim.id}`,
          message: `Extension .${extension} is claimed by multiple DLC languages`,
        });
      }
      continue;
    }
    const claim = claims[0];
    customByExtension.set(extension, {
      id: claim.id,
      name: claim.name,
      highlighter: claim.highlighter,
    });
  }

  return {
    registry: new EditorLanguageRegistry(customByExtension),
    diagnostics,
  };
}
