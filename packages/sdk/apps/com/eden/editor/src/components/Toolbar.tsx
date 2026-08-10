import { FiFolder, FiRotateCcw, FiRotateCw, FiSave } from "solid-icons/fi";
import { locale, t } from "../i18n";
import { localizedLanguageName } from "../language-registry";
import type { EditorTab } from "../types";

interface ToolbarProps {
  activeTab: EditorTab | undefined;
  isSaving: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onOpen: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function Toolbar(props: ToolbarProps) {
  return (
    <div class="editor-toolbar">
      <div class="toolbar-info">
        <span class="file-path">{props.activeTab?.path}</span>
        <span class="file-language">
          {props.activeTab
            ? localizedLanguageName(props.activeTab.languageName, locale())
            : ""}
        </span>
      </div>
      <div class="toolbar-actions">
        <div class="toolbar-action-group">
          <button
            type="button"
            class="eden-btn eden-btn-ghost editor-tool-button"
            onClick={props.onUndo}
            disabled={!props.canUndo}
            aria-label={t("editor.undo")}
            title={`${t("editor.undo")} (Ctrl+Z)`}
          >
            <FiRotateCcw aria-hidden="true" size={18} />
          </button>
          <button
            type="button"
            class="eden-btn eden-btn-ghost editor-tool-button"
            onClick={props.onRedo}
            disabled={!props.canRedo}
            aria-label={t("editor.redo")}
            title={`${t("editor.redo")} (Ctrl+Shift+Z)`}
          >
            <FiRotateCw aria-hidden="true" size={18} />
          </button>
        </div>
        <div class="toolbar-action-group">
          <button
            type="button"
            class="eden-btn eden-btn-ghost editor-tool-button"
            onClick={props.onOpen}
            aria-label={t("editor.openFile")}
            title={`${t("editor.openFile")} (Ctrl+O)`}
          >
            <FiFolder aria-hidden="true" size={18} />
          </button>
          <button
            type="button"
            class="eden-btn eden-btn-ghost editor-tool-button"
            onClick={props.onSave}
            disabled={!props.activeTab?.isModified || props.isSaving}
            aria-label={t("common.save")}
            title={`${t("common.save")} (Ctrl+S)`}
          >
            <FiSave aria-hidden="true" size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
