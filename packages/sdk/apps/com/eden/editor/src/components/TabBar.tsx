import { For } from "solid-js";
import type { EditorTab } from "../types";

interface TabBarProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  onTabClick: (tab: EditorTab) => void;
  onTabClose: (tabId: string) => void;
}

export function TabBar(props: TabBarProps) {
  const handleTabKeyDown = (tab: EditorTab, e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      props.onTabClick(tab);
    }
  };

  return (
    <div class="editor-tabs" role="tablist">
      <For each={props.tabs}>
        {(tab) => (
          <div
            class={`editor-tab ${props.activeTabId === tab.id ? "active" : ""} ${tab.isModified ? "modified" : ""}`}
            role="tab"
            tabIndex={props.activeTabId === tab.id ? 0 : -1}
            aria-selected={props.activeTabId === tab.id}
            onClick={() => props.onTabClick(tab)}
            onKeyDown={(e) => handleTabKeyDown(tab, e)}
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
