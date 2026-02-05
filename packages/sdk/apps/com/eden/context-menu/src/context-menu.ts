import type {
  ContextMenuOpenEvent,
  ContextMenuResult,
  WindowSize,
  ViewBounds,
} from "@edenapp/types";
import { resolveIconSvg } from "./icons";

const root = document.getElementById("context-menu-root")!;
const overlay = document.getElementById("context-menu-overlay")!;
const menu = document.getElementById("context-menu")!;
const titleEl = document.getElementById("context-menu-title")!;
const itemsEl = document.getElementById("context-menu-items")!;
if (!root || !overlay || !menu || !titleEl || !itemsEl) {
  throw new Error("Context menu elements not found");
}

let windowSize: WindowSize | null = null;
let activeMenu: {
  requestId: string;
  position: ContextMenuOpenEvent["position"];
} | null = null;

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
    await window.edenAPI.shellCommand("view/update-view-bounds", {
      appId: "com.eden.context-menu",
      bounds,
    });
  } catch (err) {
    console.error("Failed to update context menu bounds:", err);
  }
}

function setMenuVisible(visible: boolean): void {
  root.classList.toggle("is-open", visible);
}

/**
 * Resolve an icon name to SVG content.
 * Only allows curated icon names from the allowlist to prevent XSS.
 */
function resolveIcon(icon?: string): string | null {
  if (!icon) return null;
  const name = icon.trim();
  if (!name) return null;
  return resolveIconSvg(name);
}

function renderMenu(openData: ContextMenuOpenEvent): void {
  titleEl.textContent = openData.title ?? "";
  titleEl.classList.toggle("is-visible", Boolean(openData.title));

  itemsEl.innerHTML = "";
  for (const item of openData.items) {
    if (item.type === "separator") {
      const divider = document.createElement("li");
      divider.className = "context-menu-divider";
      itemsEl.appendChild(divider);
      continue;
    }

    if (item.type === "title") {
      const title = document.createElement("li");
      title.className = "context-menu-section-title";
      title.textContent = item.label;
      itemsEl.appendChild(title);
      continue;
    }

    const entry = document.createElement("li");
    entry.className = "context-menu-item";
    if (item.danger) entry.classList.add("context-menu-item-danger");
    if (item.disabled) entry.classList.add("context-menu-item-disabled");

    const iconSvg = resolveIcon(item.icon);
    if (iconSvg) {
      const icon = document.createElement("span");
      icon.className = "context-menu-icon";
      icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconSvg}</svg>`;
      entry.appendChild(icon);
    }

    const label = document.createElement("span");
    label.className = "context-menu-label";
    label.textContent = item.label;
    entry.appendChild(label);

    if (item.shortcut) {
      const shortcut = document.createElement("span");
      shortcut.className = "context-menu-shortcut";
      shortcut.textContent = item.shortcut;
      entry.appendChild(shortcut);
    }

    if (!item.disabled) {
      entry.addEventListener("click", () => {
        closeMenu("select", item.id);
      });
    } else {
      entry.setAttribute("aria-disabled", "true");
    }

    itemsEl.appendChild(entry);
  }
}

function applyPosition(position: ContextMenuOpenEvent["position"]): void {
  menu.style.left = position.left !== undefined ? `${position.left}px` : "";
  menu.style.right = position.right !== undefined ? `${position.right}px` : "";
  menu.style.top = position.top !== undefined ? `${position.top}px` : "";
  menu.style.bottom =
    position.bottom !== undefined ? `${position.bottom}px` : "";
  menu.style.transform = "";

  window.requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    const size = windowSize ?? {
      width: window.innerWidth,
      height: window.innerHeight,
    };
    const margin = 8;

    let dx = 0;
    let dy = 0;

    if (rect.right > size.width - margin) {
      dx = size.width - margin - rect.right;
    } else if (rect.left < margin) {
      dx = margin - rect.left;
    }

    if (rect.bottom > size.height - margin) {
      dy = size.height - margin - rect.bottom;
    } else if (rect.top < margin) {
      dy = margin - rect.top;
    }

    if (dx || dy) {
      menu.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  });
}

function closeMenu(
  reason: ContextMenuResult["reason"],
  itemId?: string,
  notify: boolean = true,
): void {
  if (!activeMenu) return;
  const { requestId } = activeMenu;
  activeMenu = null;

  setMenuVisible(false);
  titleEl.textContent = "";
  titleEl.classList.remove("is-visible");
  itemsEl.innerHTML = "";
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
  };

  await updateOverlayBounds(true);
  renderMenu(openData);
  setMenuVisible(true);
  applyPosition(openData.position);
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
        applyPosition(activeMenu.position);
      }
    },
  );

  console.log("Eden Context Menu ready!");
}

void init();
