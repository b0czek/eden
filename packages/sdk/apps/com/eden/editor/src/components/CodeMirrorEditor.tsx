import type { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createEffect, onCleanup, onMount } from "solid-js";
import type { EditorTab } from "../types";

interface CodeMirrorEditorProps {
  tab: EditorTab;
  onStateChange: (tabId: string, state: EditorState) => void;
  onTabSnapshot: (
    tabId: string,
    state: EditorState,
    scrollSnapshot: StateEffect<unknown>,
  ) => void;
}

export function CodeMirrorEditor(props: CodeMirrorEditorProps) {
  let containerRef: HTMLDivElement | undefined;

  onMount(() => {
    if (!containerRef) return;

    let currentTabId = props.tab.id;
    const view = new EditorView({
      state: props.tab.state,
      parent: containerRef,
      dispatchTransactions: (transactions, editorView) => {
        editorView.update(transactions);
        props.onStateChange(currentTabId, editorView.state);
      },
    });

    createEffect(() => {
      const nextTab = props.tab;

      if (nextTab.id === currentTabId) {
        if (nextTab.state !== view.state) view.setState(nextTab.state);
        return;
      }

      const previousTabId = currentTabId;
      currentTabId = nextTab.id;
      props.onTabSnapshot(
        previousTabId,
        view.state,
        view.scrollSnapshot() as StateEffect<unknown>,
      );
      view.setState(nextTab.state);
      if (nextTab.scrollSnapshot) {
        view.dispatch({ effects: nextTab.scrollSnapshot });
      }
      view.focus();
    });

    onCleanup(() => view.destroy());
  });

  return (
    <div
      class="editor-container"
      data-eden-keyboard="floating"
      ref={containerRef}
    />
  );
}
