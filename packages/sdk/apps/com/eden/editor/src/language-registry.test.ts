import type { DlcMetadata, DlcResource } from "@edenapp/types";
import { describe, expect, it } from "vitest";
import {
  loadEditorLanguageRegistry,
  localizedLanguageName,
} from "./language-registry";

const fixtureRoot = "eden-dlc://resource/test/com.example.fixture/";

const fixtureImporter = (url: string) =>
  url.endsWith("invalid-highlighter.mjs")
    ? import("./__fixtures__/invalid-highlighter")
    : import("./__fixtures__/valid-highlighter");

function resource(
  id: string,
  languages: Array<{
    id: string;
    name?: string | Record<string, string>;
    extensions: string[];
  }>,
  entry = "valid-highlighter.mjs",
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
          extensionPoint: "language-highlighters",
          requires: "^1.0.0",
          metadata: {
            entry,
            languages: languages.map((language) => ({
              ...language,
              name: language.name ?? language.id,
            })),
          } as DlcMetadata,
        },
      ],
    },
  };
}

describe("editor DLC language registry", () => {
  it("loads a real ESM highlighter and preserves built-in fallbacks", async () => {
    const { registry, diagnostics } = await loadEditorLanguageRegistry(
      [
        resource("com.example.demo", [
          {
            id: "demo",
            name: { en: "Demo language", pl: "Język demo" },
            extensions: ["demo"],
          },
        ]),
      ],
      fixtureImporter,
    );

    expect(diagnostics).toEqual([]);
    expect(registry.resolve("PROGRAM.DEMO")).toMatchObject({
      id: "demo",
      name: { en: "Demo language", pl: "Język demo" },
    });
    expect(registry.resolve("source.ts")).toEqual({
      id: "typescript",
      name: "typescript",
    });
    expect(registry.resolve("unknown.binary")).toEqual({
      id: "plaintext",
      name: "plaintext",
    });
  });

  it("rejects invalid metadata and module exports without blocking others", async () => {
    const invalidMetadata = resource("com.example.bad-metadata", [
      { id: "bad", extensions: [".bad"] },
    ]);
    const invalidModule = resource(
      "com.example.bad-module",
      [{ id: "bad-module", extensions: ["broken"] }],
      "invalid-highlighter.mjs",
    );
    const valid = resource("com.example.demo", [
      { id: "demo", extensions: ["demo"] },
    ]);

    const { registry, diagnostics } = await loadEditorLanguageRegistry(
      [invalidMetadata, invalidModule, valid],
      fixtureImporter,
    );

    expect(diagnostics.map(({ source }) => source)).toEqual([
      "com.example.bad-metadata",
      "com.example.bad-module",
    ]);
    expect(registry.resolve("part.demo").id).toBe("demo");
    expect(registry.resolve("part.bad").id).toBe("plaintext");
    expect(registry.resolve("part.broken").id).toBe("plaintext");
  });

  it("rejects ambiguous claims while retaining unrelated extensions", async () => {
    const { registry, diagnostics } = await loadEditorLanguageRegistry(
      [
        resource("com.example.alpha", [
          { id: "alpha", extensions: ["shared", "alphaext"] },
        ]),
        resource("com.example.beta", [{ id: "beta", extensions: ["shared"] }]),
        resource("com.example.json", [
          { id: "custom-json", extensions: ["json"] },
        ]),
      ],
      fixtureImporter,
    );

    expect(registry.resolve("part.shared").id).toBe("plaintext");
    expect(registry.resolve("part.alphaext").id).toBe("alpha");
    expect(registry.resolve("part.json").id).toBe("json");
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        "Extension .shared is claimed by multiple DLC languages",
        "Extension .json is provided by a built-in language",
      ]),
    );
  });

  it("rejects duplicate language IDs", async () => {
    const { registry, diagnostics } = await loadEditorLanguageRegistry(
      [
        resource("com.example.first", [{ id: "demo", extensions: ["first"] }]),
        resource("com.example.second", [
          { id: "demo", extensions: ["second"] },
        ]),
      ],
      fixtureImporter,
    );

    expect(registry.resolve("part.first").id).toBe("plaintext");
    expect(registry.resolve("part.second").id).toBe("plaintext");
    expect(diagnostics).toHaveLength(2);
  });

  it("resolves localized names with stable fallbacks", () => {
    expect(localizedLanguageName({ en: "Demo", pl: "Przykład" }, "pl")).toBe(
      "Przykład",
    );
    expect(localizedLanguageName({ en: "Demo" }, "de")).toBe("Demo");
    expect(localizedLanguageName({ fr: "Démo" }, "de")).toBe("Démo");
  });
});
