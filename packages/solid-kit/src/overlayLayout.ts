import type { ViewBounds, WindowSize } from "@edenapp/types";
import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

type MaybeAccessor<T> = T | Accessor<T>;

export interface OverlayLayoutContext {
  element: HTMLElement;
  contentRect: DOMRectReadOnly;
  scale: number;
  windowSize: WindowSize;
}

export interface OverlayLayoutOptions {
  element: Accessor<HTMLElement | null | undefined>;
  deriveBounds: (
    context: OverlayLayoutContext,
  ) => ViewBounds | null | undefined;
  enabled?: MaybeAccessor<boolean>;
  dependencies?: Accessor<unknown>[];
}

export interface OverlayLayoutController {
  scale: Accessor<number>;
  windowSize: Accessor<WindowSize | null>;
  refresh: () => void;
}

const DEFAULT_WINDOW_SIZE: WindowSize = { width: 800, height: 600 };

const readMaybeAccessor = <T>(
  value: MaybeAccessor<T> | undefined,
  fallback: T,
) =>
  typeof value === "function" ? (value as Accessor<T>)() : (value ?? fallback);

const sameBounds = (a: ViewBounds | null, b: ViewBounds) =>
  !!a &&
  a.x === b.x &&
  a.y === b.y &&
  a.width === b.width &&
  a.height === b.height;

export function createInterfaceScale(): Accessor<number> {
  const [scale, setScale] = createSignal(1);

  onMount(() => {
    const handleScaleChanged = (data: { scale: number }) => {
      if (Number.isFinite(data.scale)) {
        setScale(data.scale);
      }
    };

    void window.edenAPI
      .shellCommand("view/get-interface-scale", {})
      .then((result) => {
        if (Number.isFinite(result.scale)) {
          setScale(result.scale);
        }
      })
      .catch((error) => {
        console.error("Failed to load interface scale:", error);
      });

    void window.edenAPI
      .subscribe("view/interface-scale-changed", handleScaleChanged)
      .catch((error) => {
        console.error("Failed to subscribe to interface scale changes:", error);
      });

    onCleanup(() => {
      window.edenAPI.unsubscribe(
        "view/interface-scale-changed",
        handleScaleChanged,
      );
    });
  });

  return scale;
}

export function createOverlayLayout(
  options: OverlayLayoutOptions,
): OverlayLayoutController {
  const scale = createInterfaceScale();
  const [windowSize, setWindowSize] = createSignal<WindowSize | null>(null);
  const [contentRect, setContentRect] = createSignal<DOMRectReadOnly | null>(
    null,
  );

  let animationFrame: number | null = null;
  let lastBounds: ViewBounds | null = null;

  const updateBounds = () => {
    animationFrame = null;

    if (!readMaybeAccessor(options.enabled, true)) {
      return;
    }

    const element = options.element();
    const rect = contentRect();
    const size = windowSize();
    if (!element || !rect || !size) {
      return;
    }

    const bounds = options.deriveBounds({
      element,
      contentRect: rect,
      scale: scale(),
      windowSize: size,
    });

    if (!bounds || sameBounds(lastBounds, bounds)) {
      return;
    }

    lastBounds = bounds;
    void window.edenAPI
      .shellCommand("view/update-bounds", { bounds })
      .catch((error) => {
        console.error("Failed to update overlay bounds:", error);
      });
  };

  const scheduleRefresh = () => {
    if (animationFrame !== null) {
      return;
    }

    animationFrame = window.requestAnimationFrame(updateBounds);
  };

  createEffect(() => {
    const element = options.element();
    if (!element) {
      setContentRect(null);
      return;
    }

    setContentRect(element.getBoundingClientRect());
    scheduleRefresh();

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setContentRect(entry.contentRect);
      scheduleRefresh();
    });

    observer.observe(element);
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    scale();
    windowSize();
    readMaybeAccessor(options.enabled, true);
    for (const dependency of options.dependencies ?? []) {
      dependency();
    }
    scheduleRefresh();
  });

  onMount(() => {
    const handleBoundsChanged = (data: { windowSize: WindowSize }) => {
      setWindowSize(data.windowSize);
    };

    void window.edenAPI
      .shellCommand("view/window-size", {})
      .then(setWindowSize)
      .catch((error) => {
        console.error("Failed to load window size:", error);
        setWindowSize(DEFAULT_WINDOW_SIZE);
      });

    void window.edenAPI
      .subscribe("view/global-bounds-changed", handleBoundsChanged)
      .catch((error) => {
        console.error("Failed to subscribe to window bounds changes:", error);
      });

    onCleanup(() => {
      window.edenAPI.unsubscribe(
        "view/global-bounds-changed",
        handleBoundsChanged,
      );
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    });
  });

  return {
    scale,
    windowSize,
    refresh: scheduleRefresh,
  };
}
