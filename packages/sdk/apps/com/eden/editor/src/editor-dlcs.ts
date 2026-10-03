import type { FilesystemLocation } from "@edenapp/types";
import { openEditorDocument, saveEditorDocument } from "./document-handler";
import {
  EditorDocumentRegistry,
  loadEditorDocumentRegistry,
  type ResolvedEditorDocumentHandler,
} from "./document-registry";
import {
  EditorLanguageRegistry,
  loadEditorLanguageRegistry,
} from "./language-registry";

export interface EditorDlcDocumentState {
  resolved: ResolvedEditorDocumentHandler;
  source: Uint8Array;
}

export interface EditorDlcOpenedDocument {
  content: string;
  state: EditorDlcDocumentState;
}

export interface LoadedEditorDlcs {
  host: EditorDlcHost;
  warningSources: string[];
}

export class EditorDlcHost {
  constructor(
    private readonly languageRegistry = new EditorLanguageRegistry(),
    private readonly documentRegistry = new EditorDocumentRegistry(),
  ) {}

  resolveLanguage(path: string) {
    return this.languageRegistry.resolve(path);
  }

  async openDocument(
    location: FilesystemLocation,
  ): Promise<EditorDlcOpenedDocument | undefined> {
    const path = location.path;
    const resolved = this.documentRegistry.resolve(path);
    if (!resolved) return undefined;

    const bytes = await window.edenAPI.shellCommand("fs/read-binary", {
      location,
    });
    const opened = await openEditorDocument(path, bytes, resolved);
    return {
      content: opened.content,
      state: { resolved, source: opened.source },
    };
  }

  async saveDocument(
    location: FilesystemLocation,
    content: string,
    state: EditorDlcDocumentState,
  ): Promise<EditorDlcDocumentState> {
    const path = location.path;
    const source = await saveEditorDocument(
      path,
      content,
      state.source,
      state.resolved,
    );
    await window.edenAPI.shellCommand("fs/write-binary", {
      location: { ...location },
      content: source,
    });
    return { ...state, source };
  }
}

export async function loadEditorDlcs(): Promise<LoadedEditorDlcs> {
  const { dlcs } = await window.edenAPI.shellCommand("package/self", {});
  const [languageResult, documentResult] = await Promise.all([
    loadEditorLanguageRegistry(dlcs),
    loadEditorDocumentRegistry(dlcs),
  ]);
  const diagnostics = [
    ...languageResult.diagnostics,
    ...documentResult.diagnostics,
  ];

  for (const diagnostic of diagnostics) {
    console.warn(
      `Skipped editor extension ${diagnostic.source}: ${diagnostic.message}`,
    );
  }

  return {
    host: new EditorDlcHost(languageResult.registry, documentResult.registry),
    warningSources: [...new Set(diagnostics.map(({ source }) => source))],
  };
}
