import type {
  ContextMenuItem,
  ContextMenuOpenEvent,
  ContextMenuResult,
  ViewBounds,
  WindowSize,
} from "@edenapp/types";
import { createPanelRegistry, getContextMenuDom } from "./dom";
import { ensureMenuAppIcons, getCachedAppIcon } from "./icon-cache";
import { applyRootPosition, positionSubmenu } from "./positioning";
import { renderPanel } from "./render";
import {
  getMenuItemAtPath,
  getTriggerEntry,
  removeSubmenus,
  syncOpenItemState,
  trimSubmenuPath,
} from "./submenus";

const { root, overlay, menu, titleEl, itemsEl } = getContextMenuDom();
const { getPanelElements, createSubmenuPanel, getPanel } = createPanelRegistry({
  root,
  menu,
  titleEl,
  itemsEl,
});

let windowSize: WindowSize | null = null;
let activeMenu: {
  requestId: string;
  position: ContextMenuOpenEvent["position"];
  items: ContextMenuItem[];
} | null = null;
let openSubmenuPath: number[] = [];

async function fetchWindowSize(): Promise<WindowSize> {
  try {
    const size = await window.edenAPI.shellCommand("view/window-size", {});
    windowSize = size;
    return size;
  } catch (err) {
    console.error("Failed to get window size:", err);
    return { width: window.innerWidth, height: window.innerHeight };
  }
}

async function updateOverlayBounds(visible: boolean): Promise<void> {
  const size = windowSize ?? (await fetchWindowSize());
  const bounds: ViewBounds = visible
    ? { x: 0, y: 0, width: size.width, height: size.height }
    : { x: 0, y: 0, width: 0, height: 0 };

  try {
    await window.edenAPI.shellCommand("view/update-bounds", {
      bounds,
    });
  } catch (err) {
    console.error("Failed to update context menu bounds:", err);
  }
}

function setMenuVisible(visible: boolean): void {
  root.classList.toggle("is-open", visible);
}

function getViewportSize(): WindowSize {
  return (
    windowSize ?? {
      width: window.innerWidth,
      height: window.innerHeight,
    }
  );
}

function syncOpenSubmenuState(): void {
  syncOpenItemState(root, openSubmenuPath, getPanel);
}

function closeSubmenus(fromDepth: number): void {
  removeSubmenus(root, fromDepth);
  openSubmenuPath = trimSubmenuPath(openSubmenuPath, fromDepth);
  syncOpenSubmenuState();
}

function renderMenuPanel(
  panel: HTMLElement,
  title: string | undefined,
  items: ContextMenuItem[],
  depth: number,
  pathPrefix: number[],
): void {
  renderPanel(panel, title, items, depth, pathPrefix, {
    getPanelElements,
    getAppIcon: getCachedAppIcon,
    onOpenSubmenu: ({ entry, itemPath, submenuItems, panelDepth }) => {
      closeSubmenus(panelDepth);
      openSubmenuPath = itemPath;

      const submenuPanel = createSubmenuPanel(panelDepth);
      renderMenuPanel(
        submenuPanel,
        undefined,
        submenuItems,
        panelDepth,
        itemPath,
      );
      positionSubmenu(submenuPanel, entry, getViewportSize);
      syncOpenSubmenuState();
    },
    onCloseSubmenusFrom: closeSubmenus,
    onSelectItem: (itemId) => {
      closeMenu("select", itemId);
    },
  });
}

function restoreOpenSubmenus(path: number[]): void {
  if (!activeMenu || path.length === 0) {
    syncOpenSubmenuState();
    return;
  }

  closeSubmenus(1);

  for (let depth = 0; depth < path.length; depth += 1) {
    const currentPath = path.slice(0, depth + 1);
    const item = getMenuItemAtPath(activeMenu.items, currentPath);
    const trigger = getTriggerEntry(root, currentPath);

    if (!item || item.type !== "item" || !item.items?.length || !trigger) {
      openSubmenuPath = currentPath.slice(0, depth);
      break;
    }

    openSubmenuPath = currentPath;
    const submenuPanel = createSubmenuPanel(depth + 1);
    renderMenuPanel(
      submenuPanel,
      undefined,
      item.items,
      depth + 1,
      currentPath,
    );
    positionSubmenu(submenuPanel, trigger, getViewportSize);
  }

  syncOpenSubmenuState();
}

function closeMenu(
  reason: ContextMenuResult["reason"],
  itemId?: string,
  notify: boolean = true,
): void {
  if (!activeMenu) return;
  const { requestId } = activeMenu;
  activeMenu = null;
  openSubmenuPath = [];

  setMenuVisible(false);
  titleEl.textContent = "";
  titleEl.classList.remove("is-visible");
  itemsEl.innerHTML = "";
  closeSubmenus(1);
  void updateOverlayBounds(false);

  if (notify) {
    void window.edenAPI.shellCommand("context-menu/resolve", {
      requestId,
      itemId,
      reason,
    });
  }
}

async function openMenu(openData: ContextMenuOpenEvent): Promise<void> {
  if (activeMenu) {
    closeMenu("replaced", undefined, false);
  }

  activeMenu = {
    requestId: openData.requestId,
    position: openData.position,
    items: openData.items,
  };

  await ensureMenuAppIcons(openData.items);
  await updateOverlayBounds(true);
  setMenuVisible(true);
  renderMenuPanel(menu, openData.title, openData.items, 0, []);
  applyRootPosition(menu, openData.position, getViewportSize);
  syncOpenSubmenuState();
  menu.focus();
}

async function init(): Promise<void> {
  // Register as the display provider for context menus
  await window.edenAPI.shellCommand("context-menu/register-display", {});

  await fetchWindowSize();
  await updateOverlayBounds(false);

  overlay.addEventListener("click", () => closeMenu("dismiss"));
  menu.addEventListener("click", (event) => event.stopPropagation());
  menu.addEventListener("contextmenu", (event) => event.preventDefault());
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu("dismiss");
    }
  });

  await window.edenAPI.subscribe("context-menu/opened", ({ menu: data }) => {
    void openMenu(data);
  });

  await window.edenAPI.subscribe("context-menu/closed", (data) => {
    if (!activeMenu || activeMenu.requestId !== data.requestId) return;
    if (data.reason === "select" || data.reason === "dismiss") return;
    closeMenu(data.reason, data.itemId, false);
  });

  await window.edenAPI.subscribe(
    "view/global-bounds-changed",
    ({ windowSize: nextSize }) => {
      windowSize = nextSize;
      if (activeMenu) {
        void updateOverlayBounds(true);
        const pathToRestore = [...openSubmenuPath];
        applyRootPosition(menu, activeMenu.position, getViewportSize);
        restoreOpenSubmenus(pathToRestore);
      }
    },
  );

  console.log("Eden Context Menu ready!");
}

void init();
