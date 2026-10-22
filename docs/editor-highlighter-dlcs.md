# Add an Editor language highlighter

[Handbook](README.md) · Prerequisite: [DLC packages](dlc-packages.md)

Editor exposes the `language-highlighters` extension point for line-based syntax highlighting.
A highlighter module returns token spans and maps them to semantic Eden styles.
The [HTTP request highlighter](../packages/sdk/dlcs/com/eden/editor-http-highlighter/) is a complete example.
It adds `.http` and `.rest` file support.

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

Match keys under `highlighters` to the language IDs in the contribution metadata.
`highlightLine` receives one line without its line break and returns spans synchronously.
Each span uses zero-based UTF-16 offsets: `from` is included and `to` is excluded.
The second argument, which the tokenizer can ignore, contains the path, language ID, and one-based line number.

Token names are owned by the DLC. Map each emitted token name to one of:
`plain`, `comment`, `keyword`, `operator`, `number`, `string`, `variable`,
`property`, `type`, `function`, `label`, `heading`, `link`, `meta`, or `invalid`.
An existing tokenizer can keep its token names.
Map them to Eden styles through `tokenStyles`.
Unknown token names and `plain` spans remain unstyled.
Invalid ranges or highlighter exceptions do not stop editing.

## Build and install

DLC manifests do not execute build commands. Compile the entry module before
running Genesis, and bundle any runtime dependencies into it. For example:

```bash
npm install --save-dev @edenapp/editor-dlc @edenapp/genesis esbuild
npx esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs
npx genesis build . -o ../demo-language.edenite
```

Stop the editor before installing, replacing, or removing its DLCs. Reopen it
afterward so it can discover the new module. DLC file handlers resolve to the
host app only while the DLC is installed. A language highlighter does not add a
formatter, parser, folding rules, completion, or linting.

Built-in editor languages keep their extensions. If several DLC languages claim
the same language ID or extension, the editor skips the ambiguous claim and
shows a warning while leaving other valid languages available.
