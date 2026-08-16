import type { EditorDocumentHandlerContext } from "@edenapp/editor-dlc";
import type { ResolvedEditorDocumentHandler } from "./document-registry";

export interface OpenedEditorDocument {
  content: string;
  source: Uint8Array;
}

function contextFor(
  path: string,
  resolved: ResolvedEditorDocumentHandler,
): EditorDocumentHandlerContext {
  return { path, handlerId: resolved.id };
}

export async function openEditorDocument(
  path: string,
  bytes: Uint8Array,
  resolved: ResolvedEditorDocumentHandler,
): Promise<OpenedEditorDocument> {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("Binary filesystem read did not return a Uint8Array");
  }

  const source = bytes.slice();
  const content = await resolved.handler.open(
    source.slice(),
    contextFor(path, resolved),
  );
  if (typeof content !== "string") {
    throw new TypeError(`Document handler ${resolved.id} did not return text`);
  }

  return { content, source };
}

export async function saveEditorDocument(
  path: string,
  content: string,
  source: Uint8Array,
  resolved: ResolvedEditorDocumentHandler,
): Promise<Uint8Array> {
  const result = await resolved.handler.save(
    content,
    source.slice(),
    contextFor(path, resolved),
  );
  if (!(result instanceof Uint8Array)) {
    throw new TypeError(`Document handler ${resolved.id} did not return bytes`);
  }
  return result.slice();
}
