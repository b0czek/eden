import type {
  EdenKeyboardFocusState,
  EdenKeyboardTarget,
} from "@edenapp/types";
import { getDeepActiveElement } from "./composed-tree";
import {
  type EditableElement,
  getEditableElementBounds,
  getEditableElementFromEvent,
  getKeyboardAutodetectionMode,
  getKeyboardFocusPlacementMode,
  getKeyboardTarget,
  isEditableElement,
} from "./editable-target";

interface KeyboardAutodetectionOptions {
  reportFocusState: (state: EdenKeyboardFocusState) => void;
}

export interface RestoredContentEditableSelection {
  element: HTMLElement;
  selection: Selection;
}

export interface KeyboardAutodetectionController {
  clearActiveEditableElement(): void;
  getLiveEditableElement(): EditableElement | null;
  refreshActiveFocusState(): void;
  restoreActiveContentEditableSelection(): RestoredContentEditableSelection | null;
  scheduleFocusStateRefresh(): void;
  setup(): void;
  syncContentEditableSelection(): void;
}

export const createKeyboardAutodetection = ({
  reportFocusState,
}: KeyboardAutodetectionOptions): KeyboardAutodetectionController => {
  let activeEditableElement: EditableElement | null = null;
  let activeKeyboardTarget: EdenKeyboardTarget | undefined;
  let keyboardSessionId = 0;
  let savedContentEditableRange: Range | null = null;
  let pendingRefreshFrame: number | null = null;

  const emitFocusState = (visible: boolean): void => {
    const payload: EdenKeyboardFocusState = {
      visible,
      sessionId: keyboardSessionId,
    };

    if (visible && activeKeyboardTarget && activeEditableElement) {
      payload.target = activeKeyboardTarget;
      payload.targetBounds = getEditableElementBounds(activeEditableElement);
      payload.placementMode = getKeyboardFocusPlacementMode(
        activeEditableElement,
      );
    }

    reportFocusState(payload);
  };

  const cancelScheduledFocusStateRefresh = (): void => {
    if (pendingRefreshFrame === null) {
      return;
    }

    cancelAnimationFrame(pendingRefreshFrame);
    pendingRefreshFrame = null;
  };

  const refreshActiveFocusState = (): void => {
    cancelScheduledFocusStateRefresh();

    if (!activeEditableElement || !activeKeyboardTarget) {
      return;
    }

    if (!getLiveEditableElement()) {
      clearActiveEditableElement();
      return;
    }

    emitFocusState(true);
  };

  const scheduleFocusStateRefresh = (): void => {
    cancelScheduledFocusStateRefresh();
    pendingRefreshFrame = requestAnimationFrame(() => {
      pendingRefreshFrame = null;
      refreshActiveFocusState();
    });
  };

  const syncContentEditableSelection = (): void => {
    if (
      !activeEditableElement ||
      !(activeEditableElement instanceof HTMLElement) ||
      !activeEditableElement.isContentEditable ||
      !document.hasFocus()
    ) {
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (!activeEditableElement.contains(range.commonAncestorContainer)) {
      return;
    }

    savedContentEditableRange = range.cloneRange();
  };

  const setActiveEditableElement = (element: EditableElement): void => {
    if (getKeyboardAutodetectionMode(element) === "manual") {
      clearActiveEditableElement();
      return;
    }

    const isSameElement = activeEditableElement === element;
    activeEditableElement = element;
    activeKeyboardTarget = getKeyboardTarget(element);

    if (!isSameElement) {
      keyboardSessionId += 1;
    }

    if (element instanceof HTMLElement && element.isContentEditable) {
      syncContentEditableSelection();
    } else {
      savedContentEditableRange = null;
    }

    emitFocusState(true);
    scheduleFocusStateRefresh();
  };

  const clearActiveEditableElement = (): void => {
    cancelScheduledFocusStateRefresh();
    activeEditableElement = null;
    activeKeyboardTarget = undefined;
    savedContentEditableRange = null;
    emitFocusState(false);
  };

  const getLiveEditableElement = (): EditableElement | null => {
    if (!activeEditableElement?.isConnected) {
      return null;
    }

    if (!isEditableElement(activeEditableElement)) {
      return null;
    }

    return activeEditableElement;
  };

  const focusEditableElement = (element: EditableElement): void => {
    if (getDeepActiveElement() === element) {
      return;
    }

    element.focus({
      preventScroll: true,
    });
  };

  const restoreActiveContentEditableSelection =
    (): RestoredContentEditableSelection | null => {
      const element = getLiveEditableElement();
      if (!(element instanceof HTMLElement) || !element.isContentEditable) {
        return null;
      }

      focusEditableElement(element);
      const selection = window.getSelection();
      if (!selection) {
        return null;
      }

      selection.removeAllRanges();
      if (savedContentEditableRange) {
        selection.addRange(savedContentEditableRange.cloneRange());
      } else {
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        selection.addRange(range);
      }

      return { element, selection };
    };

  const setup = (): void => {
    const observedShadowRoots = new WeakSet<ShadowRoot>();

    const reconcileActiveEditableElement = (): void => {
      if (!activeEditableElement) {
        return;
      }

      const focusedElement = getDeepActiveElement();
      if (focusedElement === activeEditableElement) {
        return;
      }

      if (focusedElement && isEditableElement(focusedElement)) {
        setActiveEditableElement(focusedElement);
        return;
      }

      clearActiveEditableElement();
    };

    const handleFocusIn = (event: Event): void => {
      const editableElement = getEditableElementFromEvent(event);
      if (!editableElement) {
        return;
      }

      if (getKeyboardAutodetectionMode(editableElement) === "manual") {
        return;
      }

      setActiveEditableElement(editableElement);
    };

    const handleFocusOut = (): void => {
      queueMicrotask(() => {
        if (!activeEditableElement) {
          return;
        }

        if (!document.hasFocus()) {
          clearActiveEditableElement();
          return;
        }

        const nextActiveElement = getDeepActiveElement();
        if (nextActiveElement && isEditableElement(nextActiveElement)) {
          setActiveEditableElement(nextActiveElement);
          return;
        }

        clearActiveEditableElement();
      });
    };

    const observeOpenShadowRoots = (root: ParentNode): void => {
      const elements = [
        ...(root instanceof Element ? [root] : []),
        ...root.querySelectorAll("*"),
      ];

      for (const element of elements) {
        if (
          !element.shadowRoot ||
          observedShadowRoots.has(element.shadowRoot)
        ) {
          continue;
        }

        const shadowRoot = element.shadowRoot;
        observedShadowRoots.add(shadowRoot);
        shadowRoot.addEventListener("focusin", handleFocusIn, {
          capture: true,
        });
        shadowRoot.addEventListener("focusout", handleFocusOut, {
          capture: true,
        });
        observeOpenShadowRoots(shadowRoot);
      }
    };

    document.addEventListener("focusin", handleFocusIn, { capture: true });
    document.addEventListener("focusout", handleFocusOut, { capture: true });

    document.addEventListener("selectionchange", syncContentEditableSelection, {
      capture: true,
    });

    document.addEventListener(
      "scroll",
      () => {
        if (!activeEditableElement) {
          return;
        }

        scheduleFocusStateRefresh();
      },
      { capture: true, passive: true },
    );

    window.addEventListener(
      "resize",
      () => {
        if (!activeEditableElement) {
          return;
        }

        scheduleFocusStateRefresh();
      },
      { passive: true },
    );

    window.addEventListener("blur", () => {
      clearActiveEditableElement();
    });

    observeOpenShadowRoots(document);
    const documentObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) {
            observeOpenShadowRoots(node);
          }
        }
      }

      if (!activeEditableElement?.isConnected) {
        queueMicrotask(reconcileActiveEditableElement);
      }
    });
    documentObserver.observe(document, {
      childList: true,
      subtree: true,
    });
  };

  return {
    clearActiveEditableElement,
    getLiveEditableElement,
    refreshActiveFocusState,
    restoreActiveContentEditableSelection,
    scheduleFocusStateRefresh,
    setup,
    syncContentEditableSelection,
  };
};
