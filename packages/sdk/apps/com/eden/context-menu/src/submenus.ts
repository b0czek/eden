import type { ContextMenuItem } from "@edenapp/types";

export function serializePath(path: number[]): string {
  return path.join(".");
}

export function getMenuItemAtPath(
  items: ContextMenuItem[],
  path: number[],
): ContextMenuItem | null {
  let currentItems = items;
  let currentItem: ContextMenuItem | null = null;

  for (const index of path) {
    currentItem = currentItems[index] ?? null;
    if (!currentItem) return null;

    if (currentItem.type !== "item" || !currentItem.items?.length) {
      currentItems = [];
    } else {
      currentItems = currentItem.items;
    }
  }

  return currentItem;
}

export function getTriggerEntry(
  root: ParentNode,
  path: number[],
): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    `.context-menu-item[data-menu-path="${serializePath(path)}"]`,
  );
}

export function removeSubmenus(root: ParentNode, fromDepth: number): void {
  const panels = root.querySelectorAll<HTMLElement>(".context-menu-submenu");
  for (const panel of panels) {
    const depth = Number.parseInt(panel.dataset.menuDepth ?? "0", 10);
    if (depth >= fromDepth) {
      panel.remove();
    }
  }
}

export function trimSubmenuPath(
  openSubmenuPath: number[],
  fromDepth: number,
): number[] {
  return openSubmenuPath.slice(0, Math.max(0, fromDepth - 1));
}

export function syncOpenItemState(
  root: ParentNode,
  openSubmenuPath: number[],
  getPanel: (depth: number) => HTMLElement | null,
): void {
  const entries = root.querySelectorAll<HTMLElement>(".context-menu-item");
  for (const entry of entries) {
    const pathValue = entry.dataset.menuPath;
    if (!pathValue || entry.dataset.hasSubmenu !== "true") {
      entry.classList.remove("context-menu-item-open");
      delete entry.dataset.submenuSide;
      continue;
    }

    const path = pathValue
      .split(".")
      .map((value) => Number.parseInt(value, 10));
    const isOpen =
      openSubmenuPath.length >= path.length &&
      path.every((segment, index) => openSubmenuPath[index] === segment);

    entry.classList.toggle("context-menu-item-open", isOpen);

    if (!isOpen) {
      delete entry.dataset.submenuSide;
      continue;
    }

    const submenuPanel = getPanel(path.length);
    const side = submenuPanel?.dataset.submenuSide;
    if (side) {
      entry.dataset.submenuSide = side;
    } else {
      delete entry.dataset.submenuSide;
    }
  }
}
