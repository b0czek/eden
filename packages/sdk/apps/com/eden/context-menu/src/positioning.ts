import type { ContextMenuOpenEvent, WindowSize } from "@edenapp/types";

const VIEWPORT_MARGIN = 8;
const SUBMENU_OFFSET = 4;

type GetViewportSize = () => WindowSize;

function clamp(value: number, min: number, max: number): number {
  if (max <= min) return min;
  return Math.min(Math.max(value, min), max);
}

export function positionPanel(
  panel: HTMLElement,
  preferredLeft: number,
  preferredTop: number,
  getViewportSize: GetViewportSize,
): void {
  const size = getViewportSize();
  const rect = panel.getBoundingClientRect();
  const maxLeft = size.width - VIEWPORT_MARGIN - rect.width;
  const maxTop = size.height - VIEWPORT_MARGIN - rect.height;
  const left = clamp(preferredLeft, VIEWPORT_MARGIN, maxLeft);
  const top = clamp(preferredTop, VIEWPORT_MARGIN, maxTop);

  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.right = "";
  panel.style.bottom = "";
  panel.style.transform = "";
}

export function applyRootPosition(
  menu: HTMLElement,
  position: ContextMenuOpenEvent["position"],
  getViewportSize: GetViewportSize,
): void {
  const size = getViewportSize();
  const rect = menu.getBoundingClientRect();

  const preferredLeft =
    position.left ??
    (position.right !== undefined
      ? size.width - position.right - rect.width
      : VIEWPORT_MARGIN);
  const preferredTop =
    position.top ??
    (position.bottom !== undefined
      ? size.height - position.bottom - rect.height
      : VIEWPORT_MARGIN);

  positionPanel(menu, preferredLeft, preferredTop, getViewportSize);
}

export function positionSubmenu(
  panel: HTMLElement,
  trigger: HTMLElement,
  getViewportSize: GetViewportSize,
): "left" | "right" {
  const size = getViewportSize();
  const triggerRect = trigger.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();

  const rightLeft = triggerRect.right + SUBMENU_OFFSET;
  const leftLeft = triggerRect.left - panelRect.width - SUBMENU_OFFSET;
  const rightSpace = size.width - VIEWPORT_MARGIN - rightLeft;
  const leftSpace = leftLeft - VIEWPORT_MARGIN;

  const prefersRight = rightSpace >= panelRect.width || rightSpace >= leftSpace;
  const side = prefersRight ? "right" : "left";
  const preferredLeft = side === "right" ? rightLeft : leftLeft;
  const preferredTop = triggerRect.top - SUBMENU_OFFSET;

  positionPanel(panel, preferredLeft, preferredTop, getViewportSize);
  panel.dataset.submenuSide = side;
  return side;
}
