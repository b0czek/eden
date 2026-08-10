import {
  redo as redoCommand,
  redoDepth,
  undo as undoCommand,
  undoDepth,
} from "@codemirror/commands";
import type { EditorState, StateEffect } from "@codemirror/state";
import { createDialogs, DialogHost } from "@edenapp/solid-kit/dialogs";
import { filePicker } from "@edenapp/tablets";
import type { Component } from "solid-js";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import {
  CodeMirrorEditor,
  ErrorBanner,
  TabBar,
  Toolbar,
  WelcomeScreen,
} from "./components";
import { createEditorState } from "./editor-config";
import { initLocale, t } from "./i18n";
import {
  EditorLanguageRegistry,
  loadEditorLanguageRegistry,
} from "./language-registry";
import { type EditorTab, type FileOpenedEvent, getFileName } from "./types";

const App: Component = () => {
  const dialogs = createDialogs();
  const [tabs, setTabs] = createSignal<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = createSignal<string | null>(null);
  const [isSaving, setIsSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [extensionWarning, setExtensionWarning] = createSignal<string | null>(
    null,
  );
  const openingFiles = new Map<string, Promise<string>>();
  const closingTabs = new Set<string>();
  let languageRegistry = new EditorLanguageRegistry();
  let editorReady = Promise.resolve();
  let tabSequence = 0;
  let openRequestSequence = 0;

  const activeTab = () => tabs().find((tab) => tab.id === activeTabId());

  const activateTab = (tabId: string) => {
    const tab = tabs().find((candidate) => candidate.id === tabId);
    if (!tab) return;
    setActiveTabId(tabId);
    window.edenFrame?.setTitle(tab.name);
  };

  const loadTab = (path: string): Promise<string> => {
    const existing = tabs().find((tab) => tab.path === path);
    if (existing) return Promise.resolve(existing.id);

    const pending = openingFiles.get(path);
    if (pending) return pending;

    const task = (async () => {
      const fileContent = await window.edenAPI.shellCommand("fs/read", {
        path,
      });
      let tabId = "";

      setTabs((currentTabs) => {
        const alreadyOpen = currentTabs.find((tab) => tab.path === path);
        if (alreadyOpen) {
          tabId = alreadyOpen.id;
          return currentTabs;
        }

        tabId = `tab-${Date.now()}-${++tabSequence}`;
        const language = languageRegistry.resolve(path);
        const newTab: EditorTab = {
          id: tabId,
          path,
          name: getFileName(path),
          content: fileContent,
          originalContent: fileContent,
          isModified: false,
          language: language.id,
          languageName: language.name,
          state: createEditorState(path, fileContent, language),
        };
        return [...currentTabs, newTab];
      });

      return tabId;
    })();

    openingFiles.set(path, task);
    void task.finally(() => openingFiles.delete(path)).catch(() => {});
    return task;
  };

  const openFile = async (path: string) => {
    const requestId = ++openRequestSequence;
    try {
      setError(null);
      await editorReady;
      const tabId = await loadTab(path);
      if (requestId === openRequestSequence) activateTab(tabId);
    } catch (err) {
      setError(t("editor.failedToLoad", { message: (err as Error).message }));
    }
  };

  const openFileFromPicker = async () => {
    try {
      setError(null);
      const path = await filePicker.openFile({ title: t("editor.openFile") });
      if (path) await openFile(path);
    } catch (err) {
      setError(t("editor.failedToLoad", { message: (err as Error).message }));
    }
  };

  const closeTab = async (tabId: string) => {
    if (closingTabs.has(tabId)) return;
    const tab = tabs().find((candidate) => candidate.id === tabId);
    if (!tab) return;

    if (tab.isModified) {
      closingTabs.add(tabId);
      const confirmed = await dialogs.confirm({
        title: t("editor.discardTitle"),
        message: t("editor.discardMessage", { name: tab.name }),
        confirmLabel: t("editor.discard"),
        cancelLabel: t("common.cancel"),
        tone: "danger",
        role: "alertdialog",
      });
      closingTabs.delete(tabId);
      if (!confirmed) return;
    }

    const currentTabs = tabs();
    const tabIndex = currentTabs.findIndex(
      (candidate) => candidate.id === tabId,
    );
    if (tabIndex < 0) return;
    const nextTabs = currentTabs.filter((candidate) => candidate.id !== tabId);
    if (activeTabId() !== tabId) {
      setTabs((tabsToUpdate) =>
        tabsToUpdate.filter((candidate) => candidate.id !== tabId),
      );
      return;
    }

    const nextTab = nextTabs[Math.min(tabIndex, nextTabs.length - 1)];
    if (nextTab) {
      activateTab(nextTab.id);
      setTabs((tabsToUpdate) =>
        tabsToUpdate.filter((candidate) => candidate.id !== tabId),
      );
    } else {
      setTabs([]);
      setActiveTabId(null);
      window.edenFrame?.resetTitle();
    }
  };

  const saveFile = async () => {
    const active = activeTab();
    if (!active || isSaving()) return;
    const currentContent = active.state.doc.toString();

    try {
      setIsSaving(true);
      setError(null);
      await window.edenAPI.shellCommand("fs/write", {
        path: active.path,
        content: currentContent,
      });
      setTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === active.id
            ? {
                ...tab,
                originalContent: currentContent,
                isModified: tab.state.doc.toString() !== currentContent,
              }
            : tab,
        ),
      );
    } catch (err) {
      setError(t("editor.failedToSave", { message: (err as Error).message }));
    } finally {
      setIsSaving(false);
    }
  };

  const updateTabState = (tabId: string, state: EditorState) => {
    const content = state.doc.toString();
    setTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              state,
              content,
              isModified: content !== tab.originalContent,
            }
          : tab,
      ),
    );
  };

  const undo = () => {
    const active = activeTab();
    if (!active) return;
    undoCommand({
      state: active.state,
      dispatch: (transaction) => updateTabState(active.id, transaction.state),
    });
  };

  const redo = () => {
    const active = activeTab();
    if (!active) return;
    redoCommand({
      state: active.state,
      dispatch: (transaction) => updateTabState(active.id, transaction.state),
    });
  };

  const snapshotTab = (
    tabId: string,
    state: EditorState,
    scrollSnapshot: StateEffect<unknown>,
  ) => {
    const content = state.doc.toString();
    setTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              state,
              content,
              isModified: content !== tab.originalContent,
              scrollSnapshot,
            }
          : tab,
      ),
    );
  };

  const handleFileOpened = (data: FileOpenedEvent) => {
    if (!data.isDirectory) void openFile(data.path);
  };

  const initializeLanguageDlcs = async () => {
    try {
      const { dlcs } = await window.edenAPI.shellCommand("package/self", {});
      const result = await loadEditorLanguageRegistry(dlcs);
      languageRegistry = result.registry;
      if (result.diagnostics.length === 0) return;

      for (const diagnostic of result.diagnostics) {
        console.warn(
          `Skipped editor highlighter ${diagnostic.source}: ${diagnostic.message}`,
        );
      }
      const sources = [
        ...new Set(result.diagnostics.map(({ source }) => source)),
      ];
      setExtensionWarning(
        t("editor.extensionWarning", { sources: sources.join(", ") }),
      );
    } catch (err) {
      console.warn("Failed to load editor language highlighters", err);
      setExtensionWarning(t("editor.extensionLoadFailed"));
    }
  };

  onMount(() => {
    initLocale();
    editorReady = initializeLanguageDlcs();
    const launchArgs = window.edenAPI.getLaunchArgs();
    if (launchArgs.length > 0) void openFile(launchArgs[0]);

    window.edenAPI.subscribe(
      "file/opened",
      handleFileOpened as (data: unknown) => void,
    );

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;

      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveFile();
      } else if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        void openFileFromPicker();
      } else if (event.key.toLowerCase() === "w") {
        event.preventDefault();
        const active = activeTabId();
        if (active) void closeTab(active);
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

  return (
    <div class="editor-app">
      <Show when={tabs().length > 0}>
        <TabBar
          tabs={tabs()}
          activeTabId={activeTabId()}
          onTabClick={(tab) => activateTab(tab.id)}
          onTabClose={closeTab}
        />
      </Show>

      <Show when={activeTab()}>
        {(tab) => (
          <Toolbar
            activeTab={tab()}
            isSaving={isSaving()}
            canUndo={undoDepth(tab().state) > 0}
            canRedo={redoDepth(tab().state) > 0}
            onOpen={openFileFromPicker}
            onSave={saveFile}
            onUndo={undo}
            onRedo={redo}
          />
        )}
      </Show>

      <Show when={error()}>
        {(message) => (
          <ErrorBanner message={message()} onDismiss={() => setError(null)} />
        )}
      </Show>

      <Show when={extensionWarning()}>
        {(message) => (
          <ErrorBanner
            message={message()}
            tone="warning"
            onDismiss={() => setExtensionWarning(null)}
          />
        )}
      </Show>

      <Show when={tabs().length === 0}>
        <WelcomeScreen onOpen={openFileFromPicker} />
      </Show>

      <Show when={activeTab()}>
        {(tab) => (
          <CodeMirrorEditor
            tab={tab()}
            onStateChange={updateTabState}
            onTabSnapshot={snapshotTab}
          />
        )}
      </Show>

      <DialogHost dialogs={dialogs} />
    </div>
  );
};

export default App;
