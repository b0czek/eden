import { FiCheck, FiFolder } from "solid-icons/fi";
import { Show } from "solid-js";
import type { PinColor } from "../features/pinnedFolders";

// Folder labels keep their identity independently of the app's theme colors.
const colors: Record<PinColor, string> = {
  blue: "#60a5fa",
  purple: "#a78bfa",
  green: "#4ade80",
  amber: "#fbbf24",
  red: "#f87171",
  gray: "#9ca3af",
  teal: "#2dd4bf",
  pink: "#f472b6",
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
