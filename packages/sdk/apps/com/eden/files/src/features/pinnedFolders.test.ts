import { describe, expect, it } from "vitest";
import {
  defaultPinColor,
  PIN_COLORS,
  PINNED_FOLDER_LIMIT,
  type PinnedFolder,
  parsePinnedFolders,
  sameLocation,
} from "./pinnedFolders";

const pin = (path: string, volume = "home") => ({
  location: { volume, path },
  label: path.split("/").pop(),
  color: "blue",
});

describe("persisted pinned folders", () => {
  it("recovers valid entries from malformed preferences without accepting unsafe locations", () => {
    expect(parsePinnedFolders("invalid JSON")).toEqual([]);
    expect(parsePinnedFolders(JSON.stringify({ pins: [] }))).toEqual([]);
    const pins = parsePinnedFolders(
      JSON.stringify([
        null,
        { ...pin("relative"), label: "Bad path" },
        pin("/../private"),
        { ...pin("/Bad"), color: "unknown" },
        { ...pin("/Empty"), label: " " },
        pin("/Documents"),
      ]),
    );
    expect(pins.map((pin) => pin.location.path)).toEqual(["/Documents"]);
  });

  it("keeps different volumes distinct and preserves disconnected-volume addresses", () => {
    const pins = parsePinnedFolders(
      JSON.stringify([
        pin("/Projects", "usb-work"),
        pin("/Projects", "home"),
        pin("/Projects/", "home"),
      ]),
    );
    expect(pins.map((pin) => pin.location)).toEqual([
      { volume: "usb-work", path: "/Projects" },
      { volume: "home", path: "/Projects" },
    ]);
    expect(sameLocation(pins[0].location, pins[1].location)).toBe(false);
  });

  it("keeps eight pins while preserving user-selected colors", () => {
    const pins = parsePinnedFolders(
      JSON.stringify(
        [
          "One",
          "Two",
          "Three",
          "Four",
          "Five",
          "Six",
          "Seven",
          "Eight",
          "Nine",
        ].map((name) => pin(`/${name}`)),
      ),
    );
    expect(PINNED_FOLDER_LIMIT).toBe(8);
    expect(pins).toHaveLength(8);
    expect(pins.every((pin) => pin.color === "blue")).toBe(true);
    expect(pins.at(-1)?.label).toBe("Eight");
  });

  it("offers a different default color for every available pin slot", () => {
    const pins: PinnedFolder[] = [];
    for (let index = 0; index < PINNED_FOLDER_LIMIT; index++) {
      pins.push({
        location: { volume: "home", path: `/Folder-${index}` },
        label: `Folder ${index}`,
        color: defaultPinColor(pins),
      });
    }
    expect(new Set(pins.map((pin) => pin.color)).size).toBe(
      PINNED_FOLDER_LIMIT,
    );
    expect(parsePinnedFolders(JSON.stringify(pins))).toEqual(pins);
  });

  it("balances default colors once all colors are in use", () => {
    const pins = parsePinnedFolders(
      JSON.stringify(
        PIN_COLORS.map((color) => ({ ...pin(`/${color}`), color })),
      ),
    );
    expect(defaultPinColor(pins)).toBe("blue");
    pins.push({
      location: { volume: "home", path: "/Extra" },
      label: "Extra",
      color: "blue",
    });
    expect(defaultPinColor(pins)).toBe("purple");
  });

  it("uses unused colors as defaults without assigning content categories", () => {
    const pins = parsePinnedFolders(
      JSON.stringify([
        { ...pin("/Albums"), color: "blue" },
        { ...pin("/Live"), color: "purple" },
      ]),
    );
    expect(defaultPinColor(pins)).toBe("green");
    expect(parsePinnedFolders(JSON.stringify(pins))).toEqual(pins);
  });

  it("preserves existing icon-based pins when assigning the new color markers", () => {
    const pins = parsePinnedFolders(
      JSON.stringify([
        {
          location: { volume: "home", path: "/Albums" },
          label: "Albums",
          icon: "music",
        },
        {
          location: { volume: "usb", path: "/Live" },
          label: "Live sets",
          icon: "code",
        },
      ]),
    );
    expect(pins).toEqual([
      {
        location: { volume: "home", path: "/Albums" },
        label: "Albums",
        color: "blue",
      },
      {
        location: { volume: "usb", path: "/Live" },
        label: "Live sets",
        color: "purple",
      },
    ]);
  });
});
