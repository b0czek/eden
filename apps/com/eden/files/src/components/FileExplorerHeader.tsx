import { createSignal } from "solid-js";
import type { Component } from "solid-js";
import Omnibox from "./Omnibox";

interface Breadcrumb {
  name: string;
  path: string;
}

interface FileExplorerHeaderProps {
  currentPath: string;
  historyIndex: number;
  historyLength: number;
  breadcrumbs: Breadcrumb[];
  onGoBack: () => void;
  onGoForward: () => void;
  onGoUp: () => void;
  onNavigate: (path: string) => void;
  onNewFolder: () => void;
  onNewFile: () => void;
  onOpenDisplayOptions: () => void;
}

const FileExplorerHeader: Component<FileExplorerHeaderProps> = (props) => {
  return (
    <header class="explorer-header">
      <div class="header-content">
        <div class="toolbar-left">
          <button
            class="eden-btn eden-btn-sm eden-btn-square"
            onClick={props.onGoBack}
            disabled={props.historyIndex === 0}
            title="Go back"
          >
            ←
          </button>
          <button
            class="eden-btn eden-btn-sm eden-btn-square"
            onClick={props.onGoForward}
            disabled={props.historyIndex >= props.historyLength - 1}
            title="Go forward"
          >
            →
          </button>
          <button
            class="eden-btn eden-btn-sm eden-btn-square"
            onClick={props.onGoUp}
            disabled={props.currentPath === "/"}
            title="Go up"
          >
            ↑
          </button>
        </div>

        <Omnibox
          currentPath={props.currentPath}
          breadcrumbs={props.breadcrumbs}
          onNavigate={props.onNavigate}
        />

        <div class="toolbar-right">
          <button
            class="eden-btn eden-btn-sm eden-btn-square"
            onClick={props.onNewFolder}
            title="New Folder"
          >
            📁+
          </button>
          <button
            class="eden-btn eden-btn-sm eden-btn-square"
            onClick={props.onNewFile}
            title="New File"
          >
            📄+
          </button>
          <button
            class="eden-btn eden-btn-sm eden-btn-square"
            onClick={props.onOpenDisplayOptions}
            title="Display Options"
          >
            ⋯
          </button>
        </div>
      </div>
    </header>
  );
};

export default FileExplorerHeader;
