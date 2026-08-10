import type {
  TileLayoutDirection,
  TileLayoutNeighbor,
  TileLayoutState,
} from "@edenapp/types";
import { getAppName } from "./ui-builder.js";

interface LayoutCompassOptions {
  getLocale: () => string;
  getMode: () => "tiled" | "floating";
}

interface CompassCopy {
  heading: string;
  expand: (direction: string, name: string) => string;
  swap: (direction: string, name: string) => string;
  directions: Record<TileLayoutDirection, string>;
}

const copy: Record<"en" | "pl", CompassCopy> = {
  en: {
    heading: "Arrange window",
    expand: (direction, name) => `Expand ${direction} over ${name}`,
    swap: (direction, name) => `Swap ${direction} with ${name}`,
    directions: { top: "up", right: "right", bottom: "down", left: "left" },
  },
  pl: {
    heading: "Ułóż okno",
    expand: (direction, name) => `Rozszerz ${direction} na ${name}`,
    swap: (direction, name) => `Zamień ${direction} z ${name}`,
    directions: {
      top: "w górę",
      right: "w prawo",
      bottom: "w dół",
      left: "w lewo",
    },
  },
};

const directions: TileLayoutDirection[] = ["top", "right", "bottom", "left"];

function getCopy(locale: string): CompassCopy {
  return locale.toLowerCase().startsWith("pl") ? copy.pl : copy.en;
}

export function setupLayoutCompass(
  overlay: HTMLElement,
  options: LayoutCompassOptions,
): { close: () => void; refreshLocale: () => void } {
  const titleButton = overlay.querySelector<HTMLElement>(
    "#eden-app-frame-title",
  );
  const compass = overlay.querySelector<HTMLElement>(
    "#eden-tile-layout-compass",
  );
  const heading = overlay.querySelector<HTMLElement>(
    "#eden-tile-layout-heading-text",
  );
  if (!titleButton || !compass || !heading) {
    return { close: () => {}, refreshLocale: () => {} };
  }

  let state: TileLayoutState | null = null;
  let busy = false;

  const close = (): void => {
    compass.hidden = true;
    if (options.getMode() === "tiled") {
      titleButton.setAttribute("aria-expanded", "false");
    } else {
      titleButton.removeAttribute("aria-expanded");
    }
    state = null;
  };

  const getNeighborName = (neighbor: TileLayoutNeighbor): string =>
    getAppName(neighbor.name, options.getLocale());

  const actionLabel = (
    action: "expand" | "swap",
    direction: TileLayoutDirection,
    neighbor: TileLayoutNeighbor,
  ): string => {
    const strings = getCopy(options.getLocale());
    const name = getNeighborName(neighbor);
    return strings[action](strings.directions[direction], name);
  };

  const render = (nextState: TileLayoutState): void => {
    state = nextState;
    const strings = getCopy(options.getLocale());
    heading.textContent = strings.heading;
    compass.setAttribute("aria-label", strings.heading);

    for (const direction of directions) {
      const edge = compass.querySelector<HTMLElement>(
        `[data-layout-direction="${direction}"]`,
      );
      const neighbor = nextState.neighbors[direction];
      if (!edge) continue;

      edge.classList.toggle("has-neighbor", Boolean(neighbor));

      for (const action of ["expand", "swap"] as const) {
        const button = edge.querySelector<HTMLButtonElement>(
          `[data-layout-action="${action}"]`,
        );
        if (!button) continue;
        const enabled = Boolean(
          neighbor && (action === "swap" || neighbor.canExpand),
        );
        button.disabled = !enabled || busy;
        button.dataset.direction = direction;
        if (neighbor) {
          const label = actionLabel(action, direction, neighbor);
          button.title = label;
          button.setAttribute("aria-label", label);
        } else {
          button.removeAttribute("title");
          button.removeAttribute("aria-label");
        }
      }
    }
  };

  const refreshLocale = (): void => {
    if (state) {
      render(state);
    }
  };

  const open = async (): Promise<void> => {
    if (options.getMode() !== "tiled" || busy) return;
    if (!compass.hidden) {
      close();
      return;
    }

    busy = true;

    try {
      const nextState = await window.edenAPI.shellCommand(
        "view/tile-layout-state",
        {},
      );
      busy = false;
      if (nextState.mode !== "tiled" || options.getMode() !== "tiled") {
        close();
        return;
      }
      const hasNeighbor = Object.values(nextState.neighbors).some(Boolean);
      if (!hasNeighbor) {
        close();
        return;
      }
      compass.hidden = false;
      titleButton.setAttribute("aria-expanded", "true");
      render(nextState);
    } catch {
      busy = false;
      close();
    }
  };

  const runAction = async (
    action: "expand" | "swap",
    direction: TileLayoutDirection,
  ): Promise<void> => {
    if (busy) return;
    busy = true;
    if (state) render(state);

    try {
      const nextState = await window.edenAPI.shellCommand(
        `view/${action}-tile`,
        { direction },
      );
      busy = false;
      if (!Object.values(nextState.neighbors).some(Boolean)) {
        close();
        return;
      }
      render(nextState);
    } catch {
      busy = false;
      close();
    }
  };

  titleButton.addEventListener("click", () => void open());
  titleButton.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void open();
  });
  compass.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      "button[data-layout-action]",
    );
    if (!button || button.disabled) return;
    const action = button.dataset.layoutAction as "expand" | "swap";
    void runAction(action, button.dataset.direction as TileLayoutDirection);
  });

  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        !compass.hidden &&
        !compass.contains(target) &&
        !titleButton.contains(target)
      ) {
        close();
      }
    },
    true,
  );
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  return { close, refreshLocale };
}
