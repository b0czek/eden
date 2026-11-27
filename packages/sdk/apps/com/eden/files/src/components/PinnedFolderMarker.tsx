import { FiCheck, FiFolder } from "solid-icons/fi";
import { Show } from "solid-js";
import type { PinColor } from "../features/pinnedFolders";

// Folder labels keep their hue independently of the app's theme colors. Each
// scheme gets its own shade so markers and swatch checkmarks stay readable.
const colors: Record<PinColor, string> = {
  blue: "light-dark(#2563eb, #60a5fa)",
  purple: "light-dark(#7c3aed, #a78bfa)",
  green: "light-dark(#16a34a, #4ade80)",
  amber: "light-dark(#d97706, #fbbf24)",
  red: "light-dark(#dc2626, #f87171)",
  gray: "light-dark(#4b5563, #9ca3af)",
  teal: "light-dark(#0d9488, #2dd4bf)",
  pink: "light-dark(#db2777, #f472b6)",
};

export function PinnedFolderMarker(props: { color: PinColor }) {
  return (
    <span
      class="files-pin-marker"
      data-pin-color={props.color}
      style={{ "--files-pin-color": colors[props.color] }}
      aria-hidden="true"
    >
      <FiFolder />
    </span>
  );
}

export function PinColorSwatch(props: { color: PinColor; selected: boolean }) {
  return (
    <span
      class="files-pin-color-swatch"
      style={{ "--files-pin-color": colors[props.color] }}
      aria-hidden="true"
    >
      <Show when={props.selected}>
        <FiCheck />
      </Show>
    </span>
  );
}
