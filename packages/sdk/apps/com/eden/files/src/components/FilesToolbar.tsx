import {
  buildBreadcrumbs,
  FileExplorerHeader,
  type FileExplorerLabels,
} from "@edenapp/files-core";
import type { FilesystemLocation } from "@edenapp/types";
import { FiCheckSquare, FiX } from "solid-icons/fi";
import type { useDirectoryBrowser } from "../features/useDirectoryBrowser";
import type { useFileSelection } from "../features/useFileSelection";
import { t } from "../i18n";

interface FilesToolbarProps {
  directory: ReturnType<typeof useDirectoryBrowser>;
  location: FilesystemLocation;
  selection: ReturnType<typeof useFileSelection>;
  labels: FileExplorerLabels;
  trashSelected: boolean;
  busy: boolean;
  readOnly: boolean;
  onRefresh: () => void;
  onNewFolder: () => Promise<void>;
  onNewFile: () => Promise<void>;
  onOpenDisplayOptions: () => void;
}

export function FilesToolbar(props: FilesToolbarProps) {
  const selectionLabel = () =>
    props.selection.selectionMode() ? t("files.done") : t("files.select");

  return (
    <FileExplorerHeader
      labels={props.labels}
      currentPath={props.location.path}
      currentVolume={props.location.volume}
      canGoUp={!props.trashSelected && props.directory.navigation.canGoUp()}
      volumes={props.directory.navigation.volumes()}
      showVolumeSelector={false}
      readOnly={props.readOnly}
      onRefresh={props.onRefresh}
      onVolumeChange={props.directory.selectVolume}
      historyIndex={props.directory.navigation.historyIndex()}
      historyLength={props.directory.navigation.navigationHistory().length}
      breadcrumbs={
        props.trashSelected
          ? [
              { name: "/", path: "/" },
              { name: t("files.trash"), path: props.location.path },
            ]
          : buildBreadcrumbs(props.location.path)
      }
      onGoBack={props.directory.goBack}
      onGoForward={props.directory.goForward}
      onGoUp={props.directory.goUp}
      onNavigate={(path) =>
        props.directory.navigate(path, undefined, props.location.volume)
      }
      endActions={
        <button
          type="button"
          class="eden-btn eden-btn-square eden-btn-sm file-select-button"
          aria-label={selectionLabel()}
          title={selectionLabel()}
          disabled={props.busy}
          onClick={() =>
            props.selection.selectionMode()
              ? props.selection.exit()
              : props.selection.start()
          }
        >
          {props.selection.selectionMode() ? (
            <FiX aria-hidden="true" />
          ) : (
            <FiCheckSquare aria-hidden="true" />
          )}
        </button>
      }
      onNewFolder={() => void props.onNewFolder()}
      onNewFile={() => void props.onNewFile()}
      onOpenDisplayOptions={props.onOpenDisplayOptions}
    />
  );
}
