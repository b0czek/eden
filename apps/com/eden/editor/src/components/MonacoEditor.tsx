import { onCleanup } from "solid-js";
import * as monaco from "monaco-editor";
import type { EditorTab } from "../types";

interface MonacoEditorProps {
  onContentChange: (content: string) => void;
  ref: (editor: monaco.editor.IStandaloneCodeEditor) => void;
}

export function MonacoEditor(props: MonacoEditorProps) {
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;

  const initEditor = (container: HTMLDivElement) => {
    editor = monaco.editor.create(container, {
      value: "",
      language: "plaintext",
      theme: "vs-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbers: "on",
      wordWrap: "off",
      scrollBeyondLastLine: false,
      renderWhitespace: "selection",
      tabSize: 2,
      padding: { top: 8 },
    });

    // Pass editor reference to parent
    props.ref(editor);

    // Track content changes
    editor.onDidChangeModelContent(() => {
      const currentContent = editor?.getValue() || "";
      props.onContentChange(currentContent);
    });

    onCleanup(() => {
      editor?.dispose();
    });
  };

  return <div class="editor-container" ref={initEditor}></div>;
}

// Helper functions for editor operations
export function setEditorContent(
  editor: monaco.editor.IStandaloneCodeEditor | undefined,
  content: string,
  language: string
) {
  if (!editor) return;
  
  const model = editor.getModel();
  if (model) {
    monaco.editor.setModelLanguage(model, language);
  }
  editor.setValue(content);
}

export function getEditorContent(
  editor: monaco.editor.IStandaloneCodeEditor | undefined
): string {
  return editor?.getValue() || "";
}
