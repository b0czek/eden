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
import { FiPlus } from "solid-icons/fi";
import { For, type JSX, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import {
  PINNED_FOLDER_LIMIT,
  type PinnedFolder,
  sameLocation,
} from "../features/pinnedFolders";
import { t } from "../i18n";
import { PinnedFolderMarker } from "./PinnedFolderMarker";

interface FilePlacesProps {
  volumes: FilesystemVolume[];
  currentVolume: string;
  currentLocation: FilesystemLocation;
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
  const activePin = () =>
    props.pins.some((pin) => sameLocation(pin.location, props.currentLocation));
  const pinTitle = () =>
    props.pins.length >= PINNED_FOLDER_LIMIT
      ? t("files.pinLimit", { count: PINNED_FOLDER_LIMIT })
      : props.currentLocation.path === "/"
        ? t("files.openFolderToPin")
        : activePin()
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
                selected={props.currentVolume === volume.id && !activePin()}
                aria-current={
                  props.currentVolume === volume.id && !activePin()
                    ? "location"
                    : undefined
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
                  selected={sameLocation(pin.location, props.currentLocation)}
                  aria-current={
                    sameLocation(pin.location, props.currentLocation)
                      ? "location"
                      : undefined
                  }
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
