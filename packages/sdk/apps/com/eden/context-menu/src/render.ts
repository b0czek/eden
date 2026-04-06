import type { ContextMenuItem } from "@edenapp/types";
import type { MenuPanelElements } from "./dom";
import { resolveIconSvg } from "./icons";
import { serializePath } from "./submenus";

type OpenSubmenuArgs = {
  entry: HTMLLIElement;
  itemPath: number[];
  submenuItems: ContextMenuItem[];
  panelDepth: number;
};

type RenderPanelOptions = {
  getPanelElements: (panel: HTMLElement) => MenuPanelElements;
  onOpenSubmenu: (args: OpenSubmenuArgs) => void;
  onCloseSubmenusFrom: (fromDepth: number) => void;
  onSelectItem: (itemId: string) => void;
};

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

export function renderPanel(
  panel: HTMLElement,
  title: string | undefined,
  items: ContextMenuItem[],
  depth: number,
  pathPrefix: number[],
  options: RenderPanelOptions,
): void {
  const { titleEl, itemsEl } = options.getPanelElements(panel);

  titleEl.textContent = title ?? "";
  titleEl.classList.toggle("is-visible", Boolean(title));

  itemsEl.innerHTML = "";
  items.forEach((item, index) => {
    const itemPath = [...pathPrefix, index];
    const pathValue = serializePath(itemPath);

    if (item.type === "separator") {
      const divider = document.createElement("li");
      divider.className = "context-menu-divider";
      itemsEl.appendChild(divider);
      return;
    }

    if (item.type === "title") {
      const sectionTitle = document.createElement("li");
      sectionTitle.className = "context-menu-section-title";
      sectionTitle.textContent = item.label;
      itemsEl.appendChild(sectionTitle);
      return;
    }

    const entry = document.createElement("li");
    entry.className = "context-menu-item";
    entry.dataset.menuPath = pathValue;
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

    const submenuItems = item.items?.length ? item.items : null;
    if (submenuItems) {
      entry.dataset.hasSubmenu = "true";
      const submenuIndicatorSvg = resolveIconSvg("chevron-right");
      const indicator = document.createElement("span");
      indicator.className = "context-menu-submenu-indicator";
      if (submenuIndicatorSvg) {
        indicator.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${submenuIndicatorSvg}</svg>`;
      } else {
        indicator.textContent = ">";
      }
      entry.appendChild(indicator);
    }

    if (!item.disabled) {
      if (submenuItems) {
        const openSubmenu = () => {
          options.onOpenSubmenu({
            entry,
            itemPath,
            submenuItems,
            panelDepth: depth + 1,
          });
        };

        entry.addEventListener("pointerenter", openSubmenu);
        entry.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openSubmenu();
        });
      } else {
        entry.addEventListener("pointerenter", () => {
          options.onCloseSubmenusFrom(depth + 1);
        });
        entry.addEventListener("click", () => {
          options.onSelectItem(item.id);
        });
      }
    } else {
      entry.setAttribute("aria-disabled", "true");
    }

    itemsEl.appendChild(entry);
  });
}
