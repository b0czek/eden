import {
  FaSolidArrowLeft,
  FaSolidArrowRight,
  FaSolidArrowUp,
  FaSolidEllipsis,
  FaSolidFileMedical,
  FaSolidFolderPlus,
} from "solid-icons/fa";
import type { Component, JSX } from "solid-js";
import type { Breadcrumb, FileExplorerLabels } from "../types";
import Omnibox from "./Omnibox";

export interface FileExplorerHeaderProps {
  labels: FileExplorerLabels;
  currentPath: string;
  historyIndex: number;
  historyLength: number;
  breadcrumbs: Breadcrumb[];
  onGoBack: () => void;
  onGoForward: () => void;
  onGoUp: () => void;
  onNavigate: (path: string) => void;
  onNewFolder?: () => void;
  onNewFile?: () => void;
  onOpenDisplayOptions?: () => void;
  endActions?: JSX.Element;
}

const FileExplorerHeader: Component<FileExplorerHeaderProps> = (props) => {
  return (
    <header class="explorer-header">
      <div class="header-content">
        <div class="toolbar-left">
          <button
            type="button"
            class="eden-btn eden-btn-sm eden-btn-square"
            onClick={props.onGoBack}
            disabled={props.historyIndex === 0}
            title={props.labels.goBack}
          >
            <FaSolidArrowLeft />
          </button>
          <button
            type="button"
            class="eden-btn eden-btn-sm eden-btn-square"
            onClick={props.onGoForward}
            disabled={props.historyIndex >= props.historyLength - 1}
            title={props.labels.goForward}
          >
            <FaSolidArrowRight />
          </button>
          <button
            type="button"
            class="eden-btn eden-btn-sm eden-btn-square"
            onClick={props.onGoUp}
            disabled={props.currentPath === "/"}
            title={props.labels.goUp}
          >
            <FaSolidArrowUp />
          </button>
        </div>

        <Omnibox
          labels={props.labels}
          currentPath={props.currentPath}
          breadcrumbs={props.breadcrumbs}
          onNavigate={props.onNavigate}
        />

        <div class="toolbar-right">
          {props.endActions}
          {props.onNewFolder && (
            <button
              type="button"
              class="eden-btn eden-btn-sm eden-btn-square"
              onClick={props.onNewFolder}
              title={props.labels.newFolder}
            >
              <FaSolidFolderPlus />
            </button>
          )}
          {props.onNewFile && (
            <button
              type="button"
              class="eden-btn eden-btn-sm eden-btn-square"
              onClick={props.onNewFile}
              title={props.labels.newFile}
            >
              <FaSolidFileMedical />
            </button>
          )}
          {props.onOpenDisplayOptions && (
            <button
              type="button"
              class="eden-btn eden-btn-sm eden-btn-square"
              onClick={props.onOpenDisplayOptions}
              title={props.labels.settings}
            >
              <FaSolidEllipsis />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

export { FileExplorerHeader };
export default FileExplorerHeader;
