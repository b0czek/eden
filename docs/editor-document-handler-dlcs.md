# Add an Editor document handler

[Handbook](README.md) · Prerequisite: [DLC packages](dlc-packages.md)

Editor exposes the `document-handlers` extension point for formats that can be edited as text.
A handler decodes file bytes on open and encodes the edited text on save.
Highlighting uses a separate extension point. You can supply either contribution or both.

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

Use lowercase letters, numbers, dots, and hyphens in handler IDs.
If several DLCs claim the same ID or extension, Editor skips that claim.
Other handlers remain available.

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

Match the keys under `handlers` to the IDs in the contribution metadata.
`open` receives the complete file as a `Uint8Array` and returns editable text.
`save` receives that text and the bytes from the latest successful open or save.
It returns the complete replacement file as a `Uint8Array`.
Use the previous bytes to preserve container data outside the editable text.
In this fragment, `decodeDocument` and `encodeDocument` are your format codec functions.

Editor owns file access and gives handlers byte copies.
Handlers can return values or Promises.
An exception or invalid result fails the open or save and preserves the last persisted tab state.

## Highlighting

Editor selects highlighting from the original file extension.
To highlight decoded text, contribute that extension to
[language-highlighters](editor-highlighter-dlcs.md) in this DLC or another compatible DLC.

## Build and install

DLC manifests do not run build commands. Bundle codec dependencies into the ES
module before packaging because packages cannot resolve undeclared runtime
dependencies from the Editor host.

Stop Editor before installing, replacing, or removing one of its DLCs. Reopen
it afterward so it can discover the new module. See
[App-bound DLC packages](dlc-packages.md) for packaging and lifecycle details.
