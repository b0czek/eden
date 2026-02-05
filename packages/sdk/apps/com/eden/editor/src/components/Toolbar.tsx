import { t } from "../i18n";
import type { EditorTab } from "../types";

// Floppy disk save icon
function SaveIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
      <polyline points="17 21 17 13 7 13 7 21"></polyline>
      <polyline points="7 3 7 8 15 8"></polyline>
    </svg>
  );
}

interface ToolbarProps {
  activeTab: EditorTab | undefined;
  isSaving: boolean;
  onSave: () => void;
}

export function Toolbar(props: ToolbarProps) {
  return (
    <div class="editor-toolbar">
      <div class="toolbar-info">
        <span class="file-path">{props.activeTab?.path}</span>
        <span class="file-language">{props.activeTab?.language}</span>
      </div>
      <div class="toolbar-actions">
        <button
          class="eden-btn eden-btn-sm"
          onClick={props.onSave}
          disabled={!props.activeTab?.isModified || props.isSaving}
          title={`${t("common.save")} (Ctrl+S)`}
        >
          <SaveIcon />
        </button>
      </div>
    </div>
  );
}
