import { createSignal, onCleanup, Show, onMount } from "solid-js";

// Types we need from monaco (just the interface, not the actual module)
type IStandaloneCodeEditor = import("monaco-editor").editor.IStandaloneCodeEditor;
type MonacoModule = typeof import("monaco-editor");

interface LazyMonacoEditorProps {
  onContentChange: (content: string) => void;
  ref: (editor: IStandaloneCodeEditor) => void;
  onReady?: () => void;
}

// Module-level cache for Monaco
let monacoModule: MonacoModule | null = null;
let monacoLoadPromise: Promise<MonacoModule> | null = null;

/**
 * Lazy-loads the Monaco Editor module.
 * Uses a singleton pattern to ensure it's only loaded once.
 */
async function loadMonaco(): Promise<MonacoModule> {
  if (monacoModule) {
    return monacoModule;
  }
  
  if (monacoLoadPromise) {
    return monacoLoadPromise;
  }
  
  console.log("[LazyMonaco] Starting Monaco load...");
  const startTime = performance.now();
  
  monacoLoadPromise = import("monaco-editor").then((mod) => {
    monacoModule = mod;
    console.log(`[LazyMonaco] Monaco loaded in ${(performance.now() - startTime).toFixed(0)}ms`);
    return mod;
  });
  
  return monacoLoadPromise;
}

/**
 * Lazy-loading Monaco Editor component.
 * Monaco is only loaded when this component mounts, not at app startup.
 */
export function LazyMonacoEditor(props: LazyMonacoEditorProps) {
  const [isLoading, setIsLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  
  let containerRef: HTMLDivElement | undefined;
  let editor: IStandaloneCodeEditor | undefined;

  onMount(async () => {
    try {
      const monaco = await loadMonaco();
      
      if (!containerRef) {
        throw new Error("Container ref not available");
      }
      
      editor = monaco.editor.create(containerRef, {
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
      
      setIsLoading(false);
      props.onReady?.();
      
    } catch (err) {
      console.error("[LazyMonaco] Failed to load Monaco:", err);
      setLoadError((err as Error).message);
      setIsLoading(false);
    }
  });

  onCleanup(() => {
    editor?.dispose();
  });

  return (
    <div class="editor-container" ref={containerRef}>
      <Show when={isLoading()}>
        <div class="monaco-loading">
          <div class="monaco-loading-spinner"></div>
          <span>Loading editor...</span>
        </div>
      </Show>
      <Show when={loadError()}>
        <div class="monaco-error">
          Failed to load editor: {loadError()}
        </div>
      </Show>
    </div>
  );
}

/**
 * Set editor content with language detection.
 * Handles the case where Monaco may not be loaded yet.
 */
export async function setEditorContentLazy(
  editor: IStandaloneCodeEditor | undefined,
  content: string,
  language: string
): Promise<void> {
  if (!editor) return;
  
  // Ensure Monaco is loaded (should be instant if already loaded)
  const monaco = await loadMonaco();
  
  const model = editor.getModel();
  if (model) {
    monaco.editor.setModelLanguage(model, language);
  }
  editor.setValue(content);
}

/**
 * Get editor content.
 */
export function getEditorContentLazy(
  editor: IStandaloneCodeEditor | undefined
): string {
  return editor?.getValue() || "";
}

/**
 * Pre-load Monaco in the background.
 * Call this early to start loading Monaco before it's needed.
 */
export function preloadMonaco(): void {
  loadMonaco().catch((err) => {
    console.warn("[LazyMonaco] Background preload failed:", err);
  });
}
