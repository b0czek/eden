import {
  FaSolidArrowLeft,
  FaSolidArrowRight,
  FaSolidArrowUp,
  FaSolidEllipsis,
  FaSolidFileMedical,
  FaSolidFolderPlus,
} from "solid-icons/fa";
import type { Component } from "solid-js";
import { t } from "../i18n";
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
            title={t("files.goBack")}
          >
            <FaSolidArrowLeft />
          </button>
          <button
            class="eden-btn eden-btn-sm eden-btn-square"
            onClick={props.onGoForward}
            disabled={props.historyIndex >= props.historyLength - 1}
            title={t("files.goForward")}
          >
            <FaSolidArrowRight />
          </button>
          <button
            class="eden-btn eden-btn-sm eden-btn-square"
            onClick={props.onGoUp}
            disabled={props.currentPath === "/"}
            title={t("files.goUp")}
          >
            <FaSolidArrowUp />
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
            title={t("files.newFolder")}
          >
            <FaSolidFolderPlus />
          </button>
          <button
            class="eden-btn eden-btn-sm eden-btn-square"
            onClick={props.onNewFile}
            title={t("files.newFile")}
          >
            <FaSolidFileMedical />
          </button>
          <button
            class="eden-btn eden-btn-sm eden-btn-square"
            onClick={props.onOpenDisplayOptions}
            title={t("common.settings")}
          >
            <FaSolidEllipsis />
          </button>
        </div>
      </div>
    </header>
  );
};

export default FileExplorerHeader;
