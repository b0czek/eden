import { joinPath } from "@edenapp/files-core";
import type { FilesystemLocation } from "@edenapp/types";

export const PINNED_FOLDER_LIMIT = 8;
export const PIN_COLORS = [
  "blue",
  "purple",
  "green",
  "amber",
  "red",
  "gray",
  "teal",
  "pink",
] as const;
export type PinColor = (typeof PIN_COLORS)[number];

export interface PinnedFolder {
  location: FilesystemLocation;
  label: string;
  color: PinColor;
}

export const sameLocation = (a: FilesystemLocation, b: FilesystemLocation) =>
  a.volume === b.volume && joinPath(a.path) === joinPath(b.path);

/** Balance default colors while preserving the user's own color choices. */
export function defaultPinColor(pins: PinnedFolder[]): PinColor {
  const count = (color: PinColor) =>
    pins.filter((pin) => pin.color === color).length;
  return PIN_COLORS.reduce((leastUsed, color) =>
    count(color) < count(leastUsed) ? color : leastUsed,
  );
}

/** Read app preferences without losing valid pins when a drive is disconnected. */
export function parsePinnedFolders(value: string | undefined): PinnedFolder[] {
  if (!value) return [];
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(decoded)) return [];
  const pins: PinnedFolder[] = [];
  for (const entry of decoded) {
    if (pins.length === PINNED_FOLDER_LIMIT) break;
    if (!entry || typeof entry !== "object") continue;
    const { location, label, color, icon } = entry;
    const legacyPin =
      color === undefined &&
      ["folder", "work", "code", "book", "image", "music"].includes(icon);
    if (
      !location ||
      typeof location.volume !== "string" ||
      !location.volume.trim() ||
      typeof location.path !== "string" ||
      !location.path.startsWith("/") ||
      location.path.includes("\0") ||
      location.path
        .split("/")
        .some((part: string) => part === ".." || part === ".") ||
      typeof label !== "string" ||
      !label.trim() ||
      (!legacyPin && !PIN_COLORS.includes(color)) ||
      pins.some((pin) => sameLocation(pin.location, location))
    )
      continue;
    pins.push({
      location: { volume: location.volume, path: joinPath(location.path) },
      label: label.trim().slice(0, 64),
      color: legacyPin ? defaultPinColor(pins) : color,
    });
  }
  return pins;
}
