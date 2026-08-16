import type { DlcMetadata, DlcResource } from "@edenapp/types";
import { describe, expect, it } from "vitest";
import { loadEditorDocumentRegistry } from "./document-registry";

const fixtureRoot = "eden-dlc://resource/test/com.example.fixture/";

const fixtureImporter = (url: string) =>
  url.endsWith("invalid-document-handler.mjs")
    ? import("./__fixtures__/invalid-document-handler")
    : import("./__fixtures__/valid-document-handler");

function resource(
  id: string,
  handlers: Array<{ id: string; extensions: string[] }>,
  entry = "valid-document-handler.mjs",
): DlcResource {
  return {
    rootUrl: fixtureRoot,
    manifest: {
      kind: "dlc",
      id,
      name: id,
      version: "1.0.0",
      hostAppId: "com.eden.editor",
      isPrebuilt: false,
      contributions: [
        {
          extensionPoint: "document-handlers",
          requires: "^1.0.0",
          metadata: { entry, handlers } as DlcMetadata,
        },
      ],
    },
  };
}

describe("editor DLC document registry", () => {
  it("loads a real ESM handler and resolves extensions case-insensitively", async () => {
    const { registry, diagnostics } = await loadEditorDocumentRegistry(
      [resource("com.example.demo", [{ id: "demo", extensions: ["demo"] }])],
      fixtureImporter,
    );

    expect(diagnostics).toEqual([]);
    expect(registry.resolve("DOCUMENT.DEMO")?.id).toBe("demo");
    expect(registry.resolve("document.txt")).toBeUndefined();
  });

  it("rejects invalid metadata and module exports without blocking others", async () => {
    const invalidMetadata = resource("com.example.bad-metadata", [
      { id: "bad", extensions: [".bad"] },
    ]);
    const invalidModule = resource(
      "com.example.bad-module",
      [{ id: "demo", extensions: ["broken"] }],
      "invalid-document-handler.mjs",
    );
    const valid = resource("com.example.demo", [
      { id: "demo", extensions: ["demo"] },
    ]);

    const { registry, diagnostics } = await loadEditorDocumentRegistry(
      [invalidMetadata, invalidModule, valid],
      fixtureImporter,
    );

    expect(diagnostics.map(({ source }) => source)).toEqual([
      "com.example.bad-metadata",
      "com.example.bad-module:demo",
    ]);
    expect(registry.resolve("document.demo")?.id).toBe("demo");
    expect(registry.resolve("document.bad")).toBeUndefined();
    expect(registry.resolve("document.broken")).toBeUndefined();
  });

  it("rejects ambiguous extensions while retaining unrelated claims", async () => {
    const { registry, diagnostics } = await loadEditorDocumentRegistry(
      [
        resource("com.example.alpha", [
          { id: "demo", extensions: ["shared", "alpha"] },
        ]),
        resource("com.example.beta", [
          { id: "mutation", extensions: ["shared", "beta"] },
        ]),
      ],
      fixtureImporter,
    );

    expect(registry.resolve("document.shared")).toBeUndefined();
    expect(registry.resolve("document.alpha")?.id).toBe("demo");
    expect(registry.resolve("document.beta")?.id).toBe("mutation");
    expect(diagnostics).toHaveLength(2);
    expect(
      diagnostics.every(({ message }) => message.includes(".shared")),
    ).toBe(true);
  });

  it("rejects duplicate handler IDs", async () => {
    const { registry, diagnostics } = await loadEditorDocumentRegistry(
      [
        resource("com.example.first", [{ id: "demo", extensions: ["first"] }]),
        resource("com.example.second", [
          { id: "demo", extensions: ["second"] },
        ]),
      ],
      fixtureImporter,
    );

    expect(registry.resolve("document.first")).toBeUndefined();
    expect(registry.resolve("document.second")).toBeUndefined();
    expect(diagnostics).toHaveLength(2);
  });
});
