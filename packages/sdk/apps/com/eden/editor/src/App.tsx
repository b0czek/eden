import type { Component } from "solid-js";
import { createSignal, onCleanup, onMount, Show } from "solid-js";

// Use lazy-loading components - Monaco is loaded on-demand, not at startup
import {
  ErrorBanner,
  getEditorContentLazy,
  LazyMonacoEditor,
  preloadMonaco,
  setEditorContentLazy,
  TabBar,
  Toolbar,
  WelcomeScreen,
} from "./components";
import { initLocale, t } from "./i18n";
import {
  type EditorTab,
  type FileOpenedEvent,
  getFileName,
  getLanguageFromPath,
} from "./types";

// Type for the editor instance (just the interface, not the actual module)
type IStandaloneCodeEditor =
  import("monaco-editor").editor.IStandaloneCodeEditor;

const App: Component = () => {
  const [tabs, setTabs] = createSignal<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = createSignal<string | null>(null);
  const [isSaving, setIsSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [editorReady, setEditorReady] = createSignal(false);

  let editor: IStandaloneCodeEditor | undefined;

  // Get the currently active tab
  const activeTab = () => tabs().find((t) => t.id === activeTabId());

  // Subscribe to file open events and set up keyboard shortcuts
  onMount(async () => {
    console.log("Editor app mounted");

    // Initialize i18n
    initLocale();

    // Start loading Monaco in the background immediately
    // This way it's ready by the time the user opens a file
    preloadMonaco();

    // Check for launch arguments - if app was launched with a file path, open it
    const launchArgs = window.edenAPI.getLaunchArgs();
    console.log("Launch args:", launchArgs);
    if (launchArgs.length > 0) {
      // Open the first argument as a file path
      openFile(launchArgs[0]);
    }

    // Subscribe to file open events for when app is already running
    window.edenAPI.subscribe(
      "file/opened",
      handleFileOpened as (data: unknown) => void,
    );

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveFile();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "w") {
        e.preventDefault();
        const active = activeTabId();
        if (active) closeTab(active);
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown);
      window.edenAPI.unsubscribe(
        "file/opened",
        handleFileOpened as (data: unknown) => void,
      );
    });
  });

  const handleFileOpened = (data: FileOpenedEvent) => {
    console.log("File opened:", data);
    if (!data.isDirectory) {
      openFile(data.path);
    }
  };

  const openFile = async (path: string) => {
    // Check if file is already open
    const existingTab = tabs().find((t) => t.path === path);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      switchToTab(existingTab);
      return;
    }

    try {
      setError(null);

      const fileContent = await window.edenAPI.shellCommand("fs/read", {
        path,
      });

      const newTab: EditorTab = {
        id: `tab-${Date.now()}`,
        path,
        name: getFileName(path),
        content: fileContent,
        originalContent: fileContent,
        isModified: false,
        language: getLanguageFromPath(path),
      };

      setTabs([...tabs(), newTab]);
      setActiveTabId(newTab.id);

      // Only set content if editor is ready, otherwise onEditorReady will handle it
      if (editorReady()) {
        await setEditorContentLazy(editor, fileContent, newTab.language);
      }
      window.edenFrame?.setTitle(newTab.name);
    } catch (err) {
      setError(t("editor.failedToLoad", { message: (err as Error).message }));
    }
  };

  const switchToTab = async (tab: EditorTab) => {
    setActiveTabId(tab.id);
    await setEditorContentLazy(editor, tab.content, tab.language);
    window.edenFrame?.setTitle(tab.name);
  };

  const closeTab = (tabId: string) => {
    const tabIndex = tabs().findIndex((t) => t.id === tabId);
    const newTabs = tabs().filter((t) => t.id !== tabId);
    setTabs(newTabs);

    if (activeTabId() === tabId) {
      if (newTabs.length > 0) {
        const newActiveIndex = Math.min(tabIndex, newTabs.length - 1);
        switchToTab(newTabs[newActiveIndex]);
      } else {
        setActiveTabId(null);
        if (editor) editor.setValue("");
        window.edenFrame!.resetTitle();
      }
    }
  };

  const saveFile = async () => {
    const active = activeTab();
    if (!active || isSaving()) return;

    try {
      setIsSaving(true);
      setError(null);

      const currentContent = getEditorContentLazy(editor);

      await window.edenAPI.shellCommand("fs/write", {
        path: active.path,
        content: currentContent,
      });

      setTabs(
        tabs().map((t) =>
          t.id === active.id
            ? { ...t, originalContent: currentContent, isModified: false }
            : t,
        ),
      );
    } catch (err) {
      setError(t("editor.failedToSave", { message: (err as Error).message }));
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditorContentChange = (content: string) => {
    const active = activeTab();
    if (active) {
      setTabs(
        tabs().map((t) =>
          t.id === active.id
            ? { ...t, content, isModified: content !== t.originalContent }
            : t,
        ),
      );
    }
  };

  return (
    <div class="editor-app">
      <TabBar
        tabs={tabs()}
        activeTabId={activeTabId()}
        onTabClick={switchToTab}
        onTabClose={closeTab}
      />

      <Show when={activeTab()}>
        <Toolbar
          activeTab={activeTab()}
          isSaving={isSaving()}
          onSave={saveFile}
        />
      </Show>

      <Show when={error()}>
        <ErrorBanner message={error()!} onDismiss={() => setError(null)} />
      </Show>

      <Show when={tabs().length === 0}>
        <WelcomeScreen />
      </Show>

      <Show when={tabs().length > 0}>
        <LazyMonacoEditor
          onContentChange={handleEditorContentChange}
          ref={(e: IStandaloneCodeEditor) => {
            editor = e;
          }}
          onReady={() => {
            setEditorReady(true);
            // Set content for the active tab now that editor is ready
            const active = activeTab();
            if (active) {
              setEditorContentLazy(editor, active.content, active.language);
            }
          }}
        />
      </Show>
    </div>
  );
};

export default App;
