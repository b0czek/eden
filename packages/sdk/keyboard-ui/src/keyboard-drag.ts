const DRAG_BUTTON_SELECTOR = '.hg-button[data-skbtn="{drag}"]';

const getDragButton = (target: EventTarget | null): Element | null => {
  if (!(target instanceof Element)) {
    return null;
  }

  return target.closest(DRAG_BUTTON_SELECTOR);
};

const hasScreenCoords = (event: PointerEvent) =>
  Number.isFinite(event.screenX) && Number.isFinite(event.screenY);

const hasClientCoords = (event: PointerEvent) =>
  Number.isFinite(event.clientX) && Number.isFinite(event.clientY);

const preventDragEvent = (event: PointerEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

const startMouseDrag = (event: PointerEvent) => {
  if (event.button !== 0 || !hasScreenCoords(event)) {
    return;
  }

  preventDragEvent(event);
  void window.edenKeyboard.startDrag({
    input: "system-cursor",
    point: { space: "screen", x: event.screenX, y: event.screenY },
  });

  const endDrag = (endEvent: PointerEvent) => {
    if (endEvent.pointerId !== event.pointerId) {
      return;
    }

    void window.edenKeyboard.endDrag();
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
  };

  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
};

const startRendererDrag = (event: PointerEvent, dragButton: Element) => {
  preventDragEvent(event);
  event.stopImmediatePropagation();

  if (!hasClientCoords(event)) {
    return;
  }

  dragButton.setPointerCapture(event.pointerId);
  void window.edenKeyboard.startDrag({
    input: "renderer-events",
    point: {
      space: "keyboard-client",
      x: event.clientX,
      y: event.clientY,
    },
  });

  let rafId: number | null = null;
  let pendingPoint: { x: number; y: number } | null = null;

  const flushPendingPoint = () => {
    rafId = null;
    if (!pendingPoint) {
      return;
    }

    window.edenKeyboard.updateDrag({
      point: {
        space: "keyboard-client",
        x: pendingPoint.x,
        y: pendingPoint.y,
      },
    });
    pendingPoint = null;
  };

  const moveDrag = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== event.pointerId) {
      return;
    }

    preventDragEvent(moveEvent);

    if (!hasClientCoords(moveEvent)) {
      return;
    }

    pendingPoint = { x: moveEvent.clientX, y: moveEvent.clientY };
    rafId ??= requestAnimationFrame(flushPendingPoint);
  };

  const endDrag = (endEvent: PointerEvent) => {
    if (endEvent.pointerId !== event.pointerId) {
      return;
    }

    if (dragButton.hasPointerCapture(event.pointerId)) {
      dragButton.releasePointerCapture(event.pointerId);
    }
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      flushPendingPoint();
    }
    document.removeEventListener("pointermove", moveDrag, { capture: true });
    document.removeEventListener("pointerup", endDrag);
    document.removeEventListener("pointercancel", endDrag);
    void window.edenKeyboard.endDrag();
  };

  document.addEventListener("pointermove", moveDrag, {
    passive: false,
    capture: true,
  });
  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointercancel", endDrag);
};

export const createKeyboardDragPointerDownHandler = () => {
  return (event: PointerEvent) => {
    const dragButton = getDragButton(event.target);
    if (!dragButton) {
      return;
    }

    if (event.pointerType === "mouse") {
      startMouseDrag(event);
      return;
    }

    startRendererDrag(event, dragButton);
  };
};
