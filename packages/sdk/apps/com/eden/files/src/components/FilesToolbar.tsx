import {
  buildBreadcrumbs,
  createDisplayMenu,
  type DisplayPreferences,
  FileExplorerHeader,
  type FileExplorerLabels,
  menuBelow,
} from "@edenapp/files-core";
import { button, menu } from "@edenapp/tablets";
import type { FilesystemLocation } from "@edenapp/types";
import { FiCheckSquare, FiPlus, FiX } from "solid-icons/fi";
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
  displayPreferences: DisplayPreferences;
  onRefresh: () => void;
  onNewFolder: () => Promise<void>;
  onNewFile: () => Promise<void>;
  onDisplayChange: (preferences: DisplayPreferences) => void;
}

export function FilesToolbar(props: FilesToolbarProps) {
  const selectionLabel = () =>
    props.selection.selectionMode() ? t("files.done") : t("files.select");

  const newItemMenu = menu<null>(() => [
    button("new-folder", t("files.newFolder"), props.onNewFolder, {
      icon: "folder-plus",
    }),
    button("new-file", t("files.newFile"), props.onNewFile, {
      icon: "file-plus",
    }),
  ]);
  const displayMenu = createDisplayMenu((next) => props.onDisplayChange(next));

  const showNewItemMenu = (event: MouseEvent) => {
    void newItemMenu.show(null, menuBelow(event, "left"));
  };
  const showDisplayMenu = (event: MouseEvent) => {
    void displayMenu.show(
      { labels: props.labels, preferences: props.displayPreferences },
      menuBelow(event, "right"),
    );
  };

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
      onNavigate={(path, selectedItem) =>
        props.directory.navigate(path, selectedItem, props.location.volume)
      }
      endActions={
        <>
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
          <button
            type="button"
            class="eden-btn eden-btn-square eden-btn-sm"
            aria-label={t("files.new")}
            aria-haspopup="menu"
            title={t("files.new")}
            disabled={props.readOnly}
            onClick={showNewItemMenu}
          >
            <FiPlus aria-hidden="true" />
          </button>
        </>
      }
      onOpenDisplayOptions={showDisplayMenu}
    />
  );
}
