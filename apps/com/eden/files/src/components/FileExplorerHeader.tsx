import { For } from "solid-js";
import type { Component } from "solid-js";

interface Breadcrumb {
  name: string;
  path: string;
}

interface FileExplorerHeaderProps {
  currentPath: string;
  historyIndex: number;
  breadcrumbs: Breadcrumb[];
  onGoBack: () => void;
  onGoUp: () => void;
  onRefresh: () => void;
  onNavigate: (path: string) => void;
  onNewFolder: () => void;
  onNewFile: () => void;
}

const FileExplorerHeader: Component<FileExplorerHeaderProps> = (props) => {
  return (
    <header class="explorer-header">
      <div class="header-content">
        <div class="toolbar-left">
          <button
            class="eden-btn eden-btn-sm eden-btn-icon"
            onClick={props.onGoBack}
            disabled={props.historyIndex === 0}
            title="Go back"
          >
            ←
          </button>
          <button
            class="eden-btn eden-btn-sm eden-btn-icon"
            onClick={props.onGoUp}
            disabled={props.currentPath === "/"}
            title="Go up"
          >
            ↑
          </button>
          <button
            class="eden-btn eden-btn-sm eden-btn-icon"
            onClick={props.onRefresh}
            title="Refresh"
          >
            ↻
          </button>
        </div>

        <div class="breadcrumb">
          <For each={props.breadcrumbs}>
            {(crumb, index) => (
              <>
                {index() > 0 && <span class="breadcrumb-separator">/</span>}
                <button
                  class="breadcrumb-item eden-btn eden-btn-ghost eden-btn-sm"
                  onClick={() => props.onNavigate(crumb.path)}
                >
                  {crumb.name}
                </button>
              </>
            )}
          </For>
        </div>

        <div class="toolbar-right">
          <button
            class="eden-btn eden-btn-sm eden-btn-primary"
            onClick={props.onNewFolder}
          >
            New Folder
          </button>
          <button class="eden-btn eden-btn-sm" onClick={props.onNewFile}>
            New File
          </button>
        </div>
      </div>
    </header>
  );
};

export default FileExplorerHeader;
