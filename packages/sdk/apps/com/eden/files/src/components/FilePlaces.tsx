import {
  Sidebar,
  SidebarDivider,
  SidebarItem,
  SidebarItemAction,
  SidebarSection,
} from "@edenapp/solid-kit/sidebar";
import type { FilesystemLocation, FilesystemVolume } from "@edenapp/types";
import {
  FaBrandsUsb,
  FaSolidHardDrive,
  FaSolidHouse,
  FaSolidNetworkWired,
} from "solid-icons/fa";
import { FiPlus, FiTrash2 } from "solid-icons/fi";
import { createMemo, For, type JSX, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import {
  PINNED_FOLDER_LIMIT,
  type PinnedFolder,
  sameLocation,
} from "../features/pinnedFolders";
import { t } from "../i18n";
import { PinnedFolderMarker } from "./PinnedFolderMarker";

type SelectedPlace =
  | { kind: "trash" }
  | { kind: "pin"; pin: PinnedFolder }
  | { kind: "volume"; id: string };

interface FilePlacesProps {
  volumes: FilesystemVolume[];
  currentLocation: FilesystemLocation;
  trashSelected: boolean;
  onSelectTrash: () => void;
  onTrashActions: (position: { left: number; top: number }) => void;
  pins: PinnedFolder[];
  pinCurrentDisabled: boolean;
  onPinCurrent: () => void;
  onSelectPin: (pin: PinnedFolder) => void;
  onPinActions: (
    pin: PinnedFolder,
    position: { left: number; top: number },
  ) => void;
  footer?: JSX.Element;
  isEjectPending: (volume: string) => boolean;
  onSelect: (volume: string) => void;
  onActions: (
    volume: FilesystemVolume,
    position: { left: number; top: number },
  ) => void;
}

export function FilePlaces(props: FilePlacesProps) {
  const label = (volume: FilesystemVolume) =>
    volume.id === "home" ? t("files.home") : volume.label;
  const pending = (volume: FilesystemVolume) =>
    props.isEjectPending(volume.id) || volume.state === "ejecting";
  const icon = (volume: FilesystemVolume) => {
    if (volume.id === "home") return FaSolidHouse;
    if (volume.kind === "removable") return FaBrandsUsb;
    if (volume.kind === "network") return FaSolidNetworkWired;
    return FaSolidHardDrive;
  };
  const selectedPlace = createMemo<SelectedPlace>(() => {
    if (props.trashSelected) return { kind: "trash" };
    const pin = props.pins.find((pin) =>
      sameLocation(pin.location, props.currentLocation),
    );
    return pin
      ? { kind: "pin", pin }
      : { kind: "volume", id: props.currentLocation.volume };
  });
  const volumeSelected = (id: string) => {
    const place = selectedPlace();
    return place.kind === "volume" && place.id === id;
  };
  const pinSelected = (pin: PinnedFolder) => {
    const place = selectedPlace();
    return place.kind === "pin" && place.pin === pin;
  };
  const pinTitle = () =>
    props.pins.length >= PINNED_FOLDER_LIMIT
      ? t("files.pinLimit", { count: PINNED_FOLDER_LIMIT })
      : props.currentLocation.path === "/"
        ? t("files.openFolderToPin")
        : selectedPlace().kind === "pin"
          ? t("files.folderAlreadyPinned")
          : t("files.pinCurrentFolder");
  const openContextMenu = (volume: FilesystemVolume, event: MouseEvent) => {
    event.preventDefault();
    if (volume.supportsEject)
      props.onActions(volume, { left: event.clientX, top: event.clientY });
  };

  return (
    <Sidebar
      class="files-places"
      size="compact"
      label={t("files.places")}
      heading={t("files.places")}
      footer={props.footer}
      toggleLabels={{
        collapse: t("files.collapseSidebar"),
        expand: t("files.expandSidebar"),
      }}
    >
      <SidebarSection>
        <For each={props.volumes}>
          {(volume) => (
            <div data-volume={volume.id} aria-busy={pending(volume)}>
              <SidebarItem
                label={label(volume)}
                description={volume.readOnly ? t("files.readOnly") : undefined}
                selected={volumeSelected(volume.id)}
                aria-current={
                  volumeSelected(volume.id) ? "location" : undefined
                }
                title={`${label(volume)}${volume.readOnly ? ` (${t("files.readOnly")})` : ""}`}
                disabled={volume.state !== "ready"}
                onClick={() => props.onSelect(volume.id)}
                onContextMenu={(event) => openContextMenu(volume, event)}
                icon={
                  <Show
                    when={pending(volume)}
                    fallback={<Dynamic component={icon(volume)} />}
                  >
                    <span class="eden-spinner eden-spinner-sm" />
                  </Show>
                }
                action={
                  volume.supportsEject ? (
                    <SidebarItemAction
                      aria-label={t("files.driveActions", {
                        name: label(volume),
                      })}
                      aria-haspopup="menu"
                      onContextMenu={(event) => openContextMenu(volume, event)}
                      onClick={(event) => {
                        const bounds =
                          event.currentTarget.getBoundingClientRect();
                        props.onActions(volume, {
                          left: bounds.left,
                          top: bounds.bottom,
                        });
                      }}
                    />
                  ) : undefined
                }
              />
            </div>
          )}
        </For>
        <SidebarItem
          label={t("files.trash")}
          title={t("files.trash")}
          icon={<FiTrash2 />}
          selected={selectedPlace().kind === "trash"}
          aria-current={
            selectedPlace().kind === "trash" ? "location" : undefined
          }
          onClick={props.onSelectTrash}
          onContextMenu={(event) => {
            event.preventDefault();
            props.onTrashActions({ left: event.clientX, top: event.clientY });
          }}
          action={
            <SidebarItemAction
              aria-label={t("files.trashActions")}
              aria-haspopup="menu"
              onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                props.onTrashActions({ left: bounds.left, top: bounds.bottom });
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                props.onTrashActions({
                  left: event.clientX,
                  top: event.clientY,
                });
              }}
            />
          }
        />
      </SidebarSection>
      <SidebarDivider />
      <SidebarSection
        title={t("files.pinnedFolderSlots", {
          count: props.pins.length,
          max: PINNED_FOLDER_LIMIT,
        })}
      >
        <For each={props.pins}>
          {(pin) => {
            const volume = () =>
              props.volumes.find((volume) => volume.id === pin.location.volume);
            const available = () => volume()?.state === "ready";
            const openMenu = (event: MouseEvent) => {
              event.preventDefault();
              props.onPinActions(pin, {
                left: event.clientX,
                top: event.clientY,
              });
            };
            return (
              <div
                data-pin-volume={pin.location.volume}
                data-pin-path={pin.location.path}
              >
                <SidebarItem
                  label={pin.label}
                  icon={<PinnedFolderMarker color={pin.color} />}
                  selected={pinSelected(pin)}
                  aria-current={pinSelected(pin) ? "location" : undefined}
                  disabled={!available()}
                  title={`${pin.label}\n${volume()?.label ?? pin.location.volume}: ${pin.location.path}${available() ? "" : `\n${t("files.pinnedVolumeUnavailable")}`}`}
                  onClick={() => props.onSelectPin(pin)}
                  onContextMenu={openMenu}
                  action={
                    <SidebarItemAction
                      aria-label={t("files.pinnedFolderActions", {
                        name: pin.label,
                      })}
                      aria-haspopup="menu"
                      onContextMenu={openMenu}
                      onClick={(event) => {
                        const bounds =
                          event.currentTarget.getBoundingClientRect();
                        props.onPinActions(pin, {
                          left: bounds.left,
                          top: bounds.bottom,
                        });
                      }}
                    />
                  }
                />
              </div>
            );
          }}
        </For>
        <Show when={props.pins.length < PINNED_FOLDER_LIMIT}>
          <SidebarItem
            label={t("files.pinCurrentFolder")}
            title={pinTitle()}
            icon={<FiPlus />}
            disabled={props.pinCurrentDisabled}
            onClick={props.onPinCurrent}
          />
        </Show>
      </SidebarSection>
    </Sidebar>
  );
}
