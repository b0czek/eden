import type { EditorDocumentHandler } from "@edenapp/editor-dlc";
import { describe, expect, it } from "vitest";
import { openEditorDocument, saveEditorDocument } from "./document-handler";
import type { ResolvedEditorDocumentHandler } from "./document-registry";

function resolved(
  handler: EditorDocumentHandler,
  id = "demo",
): ResolvedEditorDocumentHandler {
  return { id, handler };
}

describe("editor document handler boundary", () => {
  it("supports asynchronous open and save with document context", async () => {
    const handler = resolved({
      async open(source, context) {
        return `${context.handlerId}:${context.path}:${[...source].join(",")}`;
      },
      async save(content, source, context) {
        return new Uint8Array([
          source[0],
          context.handlerId.length,
          context.path.length,
          content.length,
        ]);
      },
    });

    const opened = await openEditorDocument(
      "/docs/archive.demo",
      new Uint8Array([255, 0, 128]),
      handler,
    );
    expect(opened.content).toBe("demo:/docs/archive.demo:255,0,128");
    expect([...opened.source]).toEqual([255, 0, 128]);

    const saved = await saveEditorDocument(
      "/docs/archive.demo",
      "edited",
      opened.source,
      handler,
    );
    expect([...saved]).toEqual([255, 4, 18, 6]);
  });

  it("protects persisted bytes from handler mutation", async () => {
    const source = new Uint8Array([7, 8, 9]);
    const handler = resolved({
      open(bytes) {
        bytes.fill(0);
        return "opened";
      },
      save(_content, bytes) {
        bytes.fill(1);
        return bytes;
      },
    });

    const opened = await openEditorDocument("archive.demo", source, handler);
    expect([...source]).toEqual([7, 8, 9]);
    expect([...opened.source]).toEqual([7, 8, 9]);

    const saved = await saveEditorDocument(
      "archive.demo",
      "edited",
      opened.source,
      handler,
    );
    expect([...opened.source]).toEqual([7, 8, 9]);
    expect([...saved]).toEqual([1, 1, 1]);
  });

  it("rejects invalid open and save results", async () => {
    const invalidOpen = resolved({
      open: () => 12 as unknown as string,
      save: () => new Uint8Array(),
    });
    await expect(
      openEditorDocument("archive.demo", new Uint8Array(), invalidOpen),
    ).rejects.toThrow("did not return text");

    const invalidSave = resolved({
      open: () => "text",
      save: () => "bytes" as unknown as Uint8Array,
    });
    await expect(
      saveEditorDocument("archive.demo", "text", new Uint8Array(), invalidSave),
    ).rejects.toThrow("did not return bytes");
  });
});
