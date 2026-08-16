import type { EditorDocumentHandlerModule } from "@edenapp/editor-dlc";

const module = {
  handlers: {
    demo: {
      async open(source, context) {
        return `${context.handlerId}:${context.path}:${[...source].join(",")}`;
      },
      async save(content, source, context) {
        return new Uint8Array([
          source[0] ?? 0,
          context.handlerId.length,
          context.path.length,
          content.length,
        ]);
      },
    },
    mutation: {
      open(source) {
        source.fill(0);
        return "opened";
      },
      save(_content, source) {
        source.fill(0);
        return source;
      },
    },
  },
} satisfies EditorDocumentHandlerModule;

export default module;
