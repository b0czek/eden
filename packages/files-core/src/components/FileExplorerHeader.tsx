import type { FilesystemVolume } from "@edenapp/types";
import {
  FaBrandsUsb,
  FaSolidArrowLeft,
  FaSolidArrowRight,
  FaSolidArrowUp,
  FaSolidEject,
  FaSolidEllipsis,
  FaSolidFileMedical,
  FaSolidFolderPlus,
  FaSolidHardDrive,
  FaSolidHouse,
  FaSolidNetworkWired,
  FaSolidRotateRight,
} from "solid-icons/fa";
import { type Component, For, type JSX, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { Breadcrumb, FileExplorerLabels } from "../types";
import Omnibox from "./Omnibox";

export interface FileExplorerHeaderProps {
  labels: FileExplorerLabels;
  currentPath: string;
  currentVolume: string;
  volumes: FilesystemVolume[];
  onVolumeChange: (volume: string) => void;
  onRefresh: () => void;
  onEject?: () => void;
  ejectPending?: boolean;
  readOnly?: boolean;
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
  const selectedVolume = () =>
    props.volumes.find((volume) => volume.id === props.currentVolume);
  const ejecting = () =>
    props.ejectPending || selectedVolume()?.state === "ejecting";
  const iconForVolume = (id: string) => {
    if (id === "home") return FaSolidHouse;
    switch (props.volumes.find((volume) => volume.id === id)?.kind) {
      case "removable":
        return FaBrandsUsb;
      case "network":
        return FaSolidNetworkWired;
      default:
        return FaSolidHardDrive;
    }
  };
  const volumeLabel = (volume: FilesystemVolume) =>
    `${volume.id === "home" ? props.labels.home : volume.label}${
      volume.readOnly ? ` (${props.labels.readOnly})` : ""
    }`;
  const selectedLabel = () => {
    const selected = props.volumes.find(
      (volume) => volume.id === props.currentVolume,
    );
    return selected ? volumeLabel(selected) : "";
  };
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

        <select
          class="eden-select explorer-volume-select"
          aria-label={props.labels.volume}
          value={props.currentVolume}
          onChange={(event) => props.onVolumeChange(event.currentTarget.value)}
        >
          <button type="button">
            <Dynamic
              component={iconForVolume(props.currentVolume)}
              class="explorer-volume-icon"
              aria-hidden="true"
            />
            <span>{selectedLabel()}</span>
          </button>
          <For each={props.volumes}>
            {(volume) => (
              <option value={volume.id} label={volumeLabel(volume)}>
                <Dynamic
                  component={iconForVolume(volume.id)}
                  class="explorer-volume-icon"
                  aria-hidden="true"
                />
                <span>{volumeLabel(volume)}</span>
              </option>
            )}
          </For>
        </select>

        <Show when={selectedVolume()?.supportsEject && props.onEject}>
          <button
            type="button"
            class="eden-btn eden-btn-sm eden-btn-square"
            onClick={props.onEject}
            disabled={ejecting()}
            aria-busy={ejecting()}
            aria-label={ejecting() ? props.labels.ejecting : props.labels.eject}
            title={ejecting() ? props.labels.ejecting : props.labels.eject}
          >
            <Show when={ejecting()} fallback={<FaSolidEject />}>
              <span class="eden-spinner eden-spinner-sm" aria-hidden="true" />
            </Show>
          </button>
        </Show>

        <Omnibox
          labels={props.labels}
          currentPath={props.currentPath}
          currentVolume={props.currentVolume}
          breadcrumbs={props.breadcrumbs}
          onNavigate={props.onNavigate}
        />

        <div class="toolbar-right">
          <button
            type="button"
            class="eden-btn eden-btn-sm eden-btn-square"
            title={props.labels.refresh}
            onClick={props.onRefresh}
          >
            <FaSolidRotateRight />
          </button>
          {props.endActions}
          {props.onNewFolder && (
            <button
              type="button"
              class="eden-btn eden-btn-sm eden-btn-square"
              disabled={props.readOnly}
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
              disabled={props.readOnly}
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
