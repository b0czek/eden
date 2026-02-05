import type {
  ContextMenuItem,
  ContextMenuOpenArgs,
  ContextMenuPosition,
  ContextMenuResult,
} from "@edenapp/types";

export type ContextMenuActionItem = Extract<ContextMenuItem, { type: "item" }> & {
  onSelect?: () => Promise<void> | void;
};

export type ContextMenuAction =
  | ContextMenuActionItem
  | Exclude<ContextMenuItem, { type: "item" }>;

export interface ContextMenuOpenOptions
  extends Omit<ContextMenuOpenArgs, "items" | "position"> {
  items: ContextMenuAction[];
  position?: ContextMenuPosition;
  event?: MouseEvent | TouchEvent | PointerEvent;
  onDismiss?: () => Promise<void> | void;
  onClose?: () => Promise<void> | void;
}

export interface EdenContextMenuAPI {
  open: (options: ContextMenuOpenOptions) => Promise<ContextMenuResult>;
  openAtCursor: (
    options: Omit<ContextMenuOpenOptions, "position" | "event">
  ) => Promise<ContextMenuResult>;
  createHandler: (
    getOptions: (
      event: MouseEvent | TouchEvent | PointerEvent
    ) => ContextMenuOpenOptions
  ) => (event: MouseEvent | TouchEvent | PointerEvent) => void;
  close: (requestId?: string) => Promise<void>;
}

type EdenAPITransport = {
  shellCommand: (command: string, args: any) => Promise<any>;
  subscribe: (event: string, handler: (payload: any) => void) => Promise<void> | void;
};

const getEdenAPI = (): EdenAPITransport => {
  if (typeof window === "undefined") {
    throw new Error("contextMenu can only be used in a browser environment.");
  }

  const api = (window as { edenAPI?: EdenAPITransport }).edenAPI;
  if (!api) {
    throw new Error("edenAPI is not available on window.");
  }

  return api;
};

const contextMenuPending = new Map<string, (result: ContextMenuResult) => void>();
let contextMenuSubscribed = false;
let lastPointer: { x: number; y: number } | null = null;
let pointerTracking = false;

const trackPointer = (x: number, y: number) => {
  lastPointer = { x, y };
};

const pointerHandler = (event: MouseEvent | PointerEvent) => {
  trackPointer(event.clientX, event.clientY);
};

const touchHandler = (event: TouchEvent) => {
  const touch = event.touches[0] || event.changedTouches[0];
  if (touch) {
    trackPointer(touch.clientX, touch.clientY);
  }
};

const ensurePointerTracking = () => {
  if (pointerTracking || typeof window === "undefined") return;
  pointerTracking = true;

  window.addEventListener("pointermove", pointerHandler, { passive: true });
  window.addEventListener("mousemove", pointerHandler, { passive: true });
  window.addEventListener("touchstart", touchHandler, { passive: true });
  window.addEventListener("touchmove", touchHandler, { passive: true });
};

const resolvePositionFromEvent = (
  event?: MouseEvent | TouchEvent | PointerEvent
): ContextMenuPosition | undefined => {
  if (!event) return undefined;
  if ("clientX" in event && "clientY" in event) {
    return { left: event.clientX, top: event.clientY };
  }
  if ("touches" in event) {
    const touch = event.touches[0] || event.changedTouches[0];
    if (touch) {
      return { left: touch.clientX, top: touch.clientY };
    }
  }
  return undefined;
};

const stripAction = (item: ContextMenuAction): ContextMenuItem => {
  if (item.type !== "item") return item;
  const { onSelect, ...rest } = item;
  return rest;
};

const ensureContextMenuSubscribed = async () => {
  if (contextMenuSubscribed) return;
  contextMenuSubscribed = true;

  const edenAPI = getEdenAPI();
  await edenAPI.subscribe("context-menu/closed", (payload) => {
    const resolver = contextMenuPending.get(payload.requestId);
    if (resolver) {
      contextMenuPending.delete(payload.requestId);
      resolver(payload);
    }
  });
};

const openContextMenu: EdenContextMenuAPI["open"] = async (options) => {
  ensurePointerTracking();
  await ensureContextMenuSubscribed();

  const position =
    options.position ||
    resolvePositionFromEvent(options.event) ||
    (lastPointer ? { left: lastPointer.x, top: lastPointer.y } : undefined) ||
    {
      left: Math.round(window.innerWidth / 2),
      top: Math.round(window.innerHeight / 2),
    };

  const edenAPI = getEdenAPI();
  const { requestId } = await edenAPI.shellCommand("context-menu/open", {
    title: options.title,
    position,
    items: options.items.map(stripAction),
  });

  return new Promise((resolve) => {
    contextMenuPending.set(requestId, (result) => {
      const run = async () => {
        try {
          if (result.itemId) {
            const selected = options.items.find(
              (item) => item.type === "item" && item.id === result.itemId
            ) as ContextMenuActionItem | undefined;
            if (selected?.onSelect) {
              await selected.onSelect();
            }
          } else if (result.reason === "dismiss" && options.onDismiss) {
            await options.onDismiss();
          }

          if (options.onClose) {
            await options.onClose();
          }
        } catch (error) {
          console.error("Context menu handler failed:", error);
        } finally {
          resolve(result);
        }
      };

      void run();
    });
  });
};

const openContextMenuAtCursor: EdenContextMenuAPI["openAtCursor"] = async (
  options
) => {
  return openContextMenu({ ...options });
};

const createContextMenuHandler: EdenContextMenuAPI["createHandler"] = (
  getOptions
) => {
  ensurePointerTracking();
  return (event) => {
    if ("preventDefault" in event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    if ("stopPropagation" in event && typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }
    const options = getOptions(event);
    void openContextMenu({ ...options, event }).catch((error) => {
      console.error("Failed to open context menu:", error);
      if (options.onClose) {
        void options.onClose();
      }
    });
  };
};

const closeContextMenu: EdenContextMenuAPI["close"] = async (requestId) => {
  const edenAPI = getEdenAPI();
  await edenAPI.shellCommand("context-menu/close", { requestId });
};

export const contextMenu: EdenContextMenuAPI = {
  open: openContextMenu,
  openAtCursor: openContextMenuAtCursor,
  createHandler: createContextMenuHandler,
  close: closeContextMenu,
};
