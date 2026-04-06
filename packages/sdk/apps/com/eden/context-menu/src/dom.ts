export type MenuPanelElements = {
  titleEl: HTMLDivElement;
  itemsEl: HTMLUListElement;
};

export interface ContextMenuDomElements {
  root: HTMLDivElement;
  overlay: HTMLDivElement;
  menu: HTMLDivElement;
  titleEl: HTMLDivElement;
  itemsEl: HTMLUListElement;
}

export interface PanelRegistry {
  getPanelElements: (panel: HTMLElement) => MenuPanelElements;
  createSubmenuPanel: (depth: number) => HTMLDivElement;
  getPanel: (depth: number) => HTMLElement | null;
}

export function getContextMenuDom(): ContextMenuDomElements {
  const root = document.getElementById(
    "context-menu-root",
  ) as HTMLDivElement | null;
  const overlay = document.getElementById(
    "context-menu-overlay",
  ) as HTMLDivElement | null;
  const menu = document.getElementById("context-menu") as HTMLDivElement | null;
  const titleEl = document.getElementById(
    "context-menu-title",
  ) as HTMLDivElement | null;
  const itemsEl = document.getElementById(
    "context-menu-items",
  ) as HTMLUListElement | null;

  if (!root || !overlay || !menu || !titleEl || !itemsEl) {
    throw new Error("Context menu elements not found");
  }

  return { root, overlay, menu, titleEl, itemsEl };
}

export function createPanelRegistry(
  elements: Pick<
    ContextMenuDomElements,
    "root" | "menu" | "titleEl" | "itemsEl"
  >,
): PanelRegistry {
  const { root, menu, titleEl, itemsEl } = elements;

  const rootPanelElements: MenuPanelElements = { titleEl, itemsEl };
  const panelElements = new WeakMap<HTMLElement, MenuPanelElements>([
    [menu, rootPanelElements],
  ]);

  menu.classList.add("context-menu-panel");
  menu.dataset.menuDepth = "0";

  const getPanelElements = (panel: HTMLElement): MenuPanelElements => {
    const existing = panelElements.get(panel);
    if (existing) return existing;

    const panelTitle = document.createElement("div");
    panelTitle.className = "eden-popover-title context-menu-title";

    const panelItems = document.createElement("ul");
    panelItems.className = "context-menu-items";

    panel.append(panelTitle, panelItems);

    const created = { titleEl: panelTitle, itemsEl: panelItems };
    panelElements.set(panel, created);
    return created;
  };

  const createSubmenuPanel = (depth: number): HTMLDivElement => {
    const panel = document.createElement("div");
    panel.className =
      "eden-popover context-menu context-menu-panel context-menu-submenu";
    panel.tabIndex = -1;
    panel.dataset.menuDepth = String(depth);
    panel.addEventListener("click", (event) => event.stopPropagation());
    panel.addEventListener("contextmenu", (event) => event.preventDefault());
    getPanelElements(panel);
    root.appendChild(panel);
    return panel;
  };

  const getPanel = (depth: number): HTMLElement | null => {
    if (depth === 0) return menu;
    return root.querySelector<HTMLElement>(
      `.context-menu-panel[data-menu-depth="${depth}"]`,
    );
  };

  return {
    getPanelElements,
    createSubmenuPanel,
    getPanel,
  };
}
