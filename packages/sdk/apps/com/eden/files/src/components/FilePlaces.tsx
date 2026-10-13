import type { FilesystemVolume } from "@edenapp/types";
import {
  FaBrandsUsb,
  FaSolidEllipsis,
  FaSolidHardDrive,
  FaSolidHouse,
  FaSolidNetworkWired,
} from "solid-icons/fa";
import { For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { t } from "../i18n";

interface FilePlacesProps {
  volumes: FilesystemVolume[];
  currentVolume: string;
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
  const openContextMenu = (volume: FilesystemVolume, event: MouseEvent) => {
    event.preventDefault();
    if (volume.supportsEject)
      props.onActions(volume, { left: event.clientX, top: event.clientY });
  };

  return (
    <nav
      class="eden-sidebar eden-sidebar-compact files-places"
      aria-label={t("files.places")}
    >
      <div class="files-places-scroll eden-scrollbar">
        <div class="eden-sidebar-section">
          <div class="eden-sidebar-section-title">{t("files.places")}</div>
          <div class="eden-sidebar-items">
            <For each={props.volumes}>
              {(volume) => (
                <div
                  class="files-place-row"
                  classList={{
                    "files-place-row-with-actions": volume.supportsEject,
                  }}
                  data-volume={volume.id}
                  aria-busy={pending(volume)}
                >
                  <button
                    type="button"
                    class="eden-sidebar-item"
                    classList={{
                      "eden-sidebar-item-selected":
                        props.currentVolume === volume.id,
                      "eden-sidebar-item-disabled": volume.state !== "ready",
                    }}
                    aria-current={
                      props.currentVolume === volume.id ? "location" : undefined
                    }
                    aria-label={label(volume)}
                    title={`${label(volume)}${volume.readOnly ? ` (${t("files.readOnly")})` : ""}`}
                    disabled={volume.state !== "ready"}
                    onClick={() => props.onSelect(volume.id)}
                    onContextMenu={(event) => openContextMenu(volume, event)}
                  >
                    <span class="eden-sidebar-item-icon">
                      <Show
                        when={pending(volume)}
                        fallback={
                          <Dynamic
                            component={icon(volume)}
                            aria-hidden="true"
                          />
                        }
                      >
                        <span
                          class="eden-spinner eden-spinner-sm"
                          aria-hidden="true"
                        />
                      </Show>
                    </span>
                    <span class="eden-sidebar-item-details">
                      <span class="eden-sidebar-item-title">
                        {label(volume)}
                      </span>
                      <Show when={volume.readOnly}>
                        <span class="eden-sidebar-item-subtitle">
                          {t("files.readOnly")}
                        </span>
                      </Show>
                    </span>
                  </button>
                  <Show when={volume.supportsEject}>
                    <button
                      type="button"
                      class="eden-btn eden-btn-ghost eden-btn-sm eden-btn-square files-place-actions"
                      aria-label={t("files.driveActions", {
                        name: label(volume),
                      })}
                      aria-haspopup="menu"
                      title={t("files.driveActions", { name: label(volume) })}
                      onContextMenu={(event) => openContextMenu(volume, event)}
                      onClick={(event) => {
                        const bounds =
                          event.currentTarget.getBoundingClientRect();
                        props.onActions(volume, {
                          left: bounds.left,
                          top: bounds.bottom,
                        });
                      }}
                    >
                      <FaSolidEllipsis
                        class="files-place-actions-wide"
                        aria-hidden="true"
                      />
                      <span
                        class="files-place-actions-narrow"
                        aria-hidden="true"
                      />
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </nav>
  );
}
