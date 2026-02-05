import { For } from "solid-js";
import type { EditorTab } from "../types";

interface TabBarProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  onTabClick: (tab: EditorTab) => void;
  onTabClose: (tabId: string) => void;
}

export function TabBar(props: TabBarProps) {
  return (
    <div class="editor-tabs">
      <For each={props.tabs}>
        {(tab) => (
          <div
            class={`editor-tab ${props.activeTabId === tab.id ? "active" : ""} ${tab.isModified ? "modified" : ""}`}
            onClick={() => props.onTabClick(tab)}
            role="tab"
          >
            <span class="tab-name">{tab.name}</span>
            <button
              type="button"
              class="tab-close"
              onClick={(e: MouseEvent) => {
                e.stopPropagation();
                props.onTabClose(tab.id);
              }}
            >
              ×
            </button>
          </div>
        )}
      </For>
    </div>
  );
}
