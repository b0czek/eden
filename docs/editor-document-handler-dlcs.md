# Editor document-handler DLCs

The Eden text editor exposes the `document-handlers` extension point for file
formats that are not stored as plain text but can be represented as one editable
text document. A handler decodes the original bytes when the file opens and
encodes the edited text when it is saved.

Document handling and syntax highlighting are independent. Editor chooses both
by the outer file extension, so a DLC may contribute a document handler, a
language highlighter, or both.

## DLC manifest

Declare each lowercase extension without a leading dot. Add the same extensions
to `fileHandlers` when Eden should route those files to Editor at the system
level.

```json
{
  "kind": "dlc",
  "id": "com.example.editor.demo-document",
  "name": "Demo document support",
  "version": "1.0.0",
  "hostAppId": "com.eden.editor",
  "fileHandlers": [
    {
      "name": "Demo documents",
      "extensions": ["demo"]
    }
  ],
  "contributions": [
    {
      "extensionPoint": "document-handlers",
      "requires": "^1.0.0",
      "metadata": {
        "entry": "dist/index.mjs",
        "handlers": [
          {
            "id": "demo-document",
            "extensions": ["demo"]
          }
        ]
      }
    }
  ]
}
```

Handler IDs use lowercase letters, numbers, dots, and hyphens. If multiple DLCs
claim the same handler ID or extension, Editor skips the ambiguous claim and
keeps unrelated handlers available.

## Handler module

Install `@edenapp/editor-dlc` as a development dependency. It is type-only, so
it does not add a runtime import inside the DLC.

```ts
import type { EditorDocumentHandlerModule } from "@edenapp/editor-dlc";

const module = {
  handlers: {
    "demo-document": {
      async open(source, context) {
        return decodeDocument(source, context.path);
      },
      async save(content, source, context) {
        return encodeDocument(content, source, context.path);
      },
    },
  },
} satisfies EditorDocumentHandlerModule;

export default module;
```

The keys under `handlers` must match the handler IDs in the contribution
metadata. `open` receives the complete file as a `Uint8Array` and returns the
text shown in CodeMirror. `save` receives the edited text and the bytes from the
latest successful open or save, then returns the complete replacement file as a
`Uint8Array`. This allows a codec to preserve parts of a container that are not
represented in the editable text.

Editor owns filesystem access and gives handlers defensive byte copies. A
handler may be synchronous or asynchronous. Exceptions and invalid return
values fail that open or save without changing the last persisted tab state.

## Highlighting

Editor resolves highlighting from the original path separately from document
decoding. To highlight the decoded text, contribute the same outer extension to
`language-highlighters` in this DLC or another compatible DLC. Neither extension
point depends on the other.

## Build and install

DLC manifests do not run build commands. Bundle codec dependencies into the ES
module before packaging because packages cannot resolve undeclared runtime
dependencies from the Editor host.

Stop Editor before installing, replacing, or removing one of its DLCs. Reopen
it afterward so it can discover the new module. See
[App-bound DLC packages](dlc-packages.md) for packaging and lifecycle details.
