import { button, menu, section, separator, submenu } from "@edenapp/tablets";
import { ITEM_SIZES } from "../constants";
import type { DisplayPreferences, FileExplorerLabels } from "../types";

interface DisplayMenuData {
  labels: FileExplorerLabels;
  preferences: DisplayPreferences;
}

/** Position a menu under the element that received the click. */
export const menuBelow = (event: MouseEvent, align: "left" | "right") => {
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const top = Math.round(bounds.bottom);
  return align === "left"
    ? { left: Math.round(bounds.left), top }
    : { right: Math.round(window.innerWidth - bounds.right), top };
};

export const createDisplayMenu = (
  onChange: (preferences: DisplayPreferences) => void,
) =>
  menu(({ labels, preferences }: DisplayMenuData) => {
    const choice = <K extends keyof DisplayPreferences>(
      key: K,
      value: DisplayPreferences[K],
      label: string,
    ) =>
      button(
        `${key}-${value}`,
        label,
        () => onChange({ ...preferences, [key]: value }),
        { checked: preferences[key] === value },
      );

    return [
      section(labels.viewStyle),
      choice("viewStyle", "grid", labels.grid),
      choice("viewStyle", "list", labels.list),
      submenu(
        "item-size",
        labels.displaySize,
        ITEM_SIZES.map((size) => choice("itemSize", size, labels[size])),
      ),
      section(labels.sortBy),
      choice("sortBy", "name", labels.name),
      choice("sortBy", "size", labels.size),
      choice("sortBy", "modified", labels.modified),
      separator(),
      choice("sortOrder", "asc", labels.ascending),
      choice("sortOrder", "desc", labels.descending),
    ];
  });
