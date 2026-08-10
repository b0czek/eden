# Editor language-highlighter DLCs

The Eden text editor exposes the `language-highlighters` extension point for
adding line-based syntax highlighting without adding the language implementation
to Eden itself. Highlighters run as host-scoped ES modules and use semantic Eden
styles rather than CodeMirror or raw CSS APIs.

Eden ships an
[HTTP request highlighter](../packages/sdk/dlcs/com/eden/editor-http-highlighter/)
as a complete DLC example. It adds `.http` and `.rest` support, which CodeMirror
does not provide as a built-in language, using the same contract and loading
path as third-party packages.

## DLC manifest

A single contribution can advertise one or more languages. Extensions are
lowercase and omit the leading dot. Declare the same extensions under
`fileHandlers` when those files should open with Editor at the system level.

```json
{
  "kind": "dlc",
  "id": "com.example.editor.demo-language",
  "name": "Demo language support",
  "version": "1.0.0",
  "hostAppId": "com.eden.editor",
  "fileHandlers": [
    {
      "name": "Demo files",
      "extensions": ["demo"]
    }
  ],
  "contributions": [
    {
      "extensionPoint": "language-highlighters",
      "requires": "^1.0.0",
      "metadata": {
        "entry": "dist/index.mjs",
        "languages": [
          {
            "id": "demo",
            "name": "Demo",
            "extensions": ["demo"]
          }
        ]
      }
    }
  ]
}
```

Language names may also be locale maps such as
`{ "en": "Demo", "pl": "Demo" }`. Language IDs must use lowercase letters,
numbers, dots, and hyphens.

## Highlighter module

Install `@edenapp/editor-dlc` as a development dependency for the public
TypeScript contract. The package is type-only, so it does not add a runtime
import that would need to resolve inside the DLC.

```ts
import type {
  EditorHighlighterModule,
  EditorHighlightSpan,
  EditorHighlightStyle,
} from "@edenapp/editor-dlc";

type DemoToken = "comment" | "numeric-value";

function highlightLine(text: string): EditorHighlightSpan<DemoToken>[] {
  const spans: EditorHighlightSpan<DemoToken>[] = [];
  const comment = text.indexOf(";");
  const code = comment < 0 ? text : text.slice(0, comment);

  for (const match of code.matchAll(/\d+(?:\.\d+)?/g)) {
    const from = match.index;
    spans.push({ from, to: from + match[0].length, kind: "numeric-value" });
  }
  if (comment >= 0) {
    spans.push({ from: comment, to: text.length, kind: "comment" });
  }
  return spans;
}

const tokenStyles = {
  comment: "comment",
  "numeric-value": "number",
} satisfies Record<DemoToken, EditorHighlightStyle>;

const module = {
  highlighters: {
    demo: { tokenStyles, highlightLine },
  },
} satisfies EditorHighlighterModule;

export default module;
```

The keys under `highlighters` must match the language IDs in the contribution
metadata.
`highlightLine` is synchronous and receives one line without its line break.
Spans use zero-based, half-open UTF-16 offsets relative to that line. The
second argument, which a tokenizer may ignore, contains the file path, language
ID, and one-based line number.

Token names are owned by the DLC. Map each emitted token name to one of:
`plain`, `comment`, `keyword`, `operator`, `number`, `string`, `variable`,
`property`, `type`, `function`, `label`, `heading`, `link`, `meta`, or `invalid`.
This means an existing tokenizer can keep domain names such as `word-axis` or
`subprogram`; only the `tokenStyles` map needs to translate them to Eden styles.
Unknown token names and `plain` spans are left unstyled. Invalid ranges and
highlighter exceptions are isolated so they cannot stop editing.

## Build and install

DLC manifests do not execute build commands. Compile the entry module before
running Genesis, and bundle any runtime dependencies into it. For example:

```json
{
  "scripts": {
    "build": "esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs",
    "package": "npm run build && genesis build . -o demo-language.edenite"
  },
  "devDependencies": {
    "@edenapp/editor-dlc": "^0.13.0",
    "esbuild": "^0.28.0"
  }
}
```

Stop the editor before installing, replacing, or removing its DLCs. Reopen it
afterward so it can discover the new module. DLC file handlers resolve to the
host app only while the DLC is installed. A language highlighter does not add a
formatter, parser, folding rules, completion, or linting.

Built-in editor languages keep their extensions. If several DLC languages claim
the same language ID or extension, the editor skips the ambiguous claim and
shows a warning while leaving other valid languages available.
