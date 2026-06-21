import type { EdenKeyboardAction } from "@edenapp/types";
import type { KeyboardAutodetectionController } from "./autodetection";
import type { EditableElement } from "./editable-target";

interface KeyboardActionController {
  applyAction(action: EdenKeyboardAction): boolean;
}

const dispatchInputEvent = (
  element: HTMLElement,
  inputType: string,
  data: string | null = null,
): void => {
  if (typeof InputEvent !== "undefined") {
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        data,
        inputType,
      }),
    );
    return;
  }

  element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
};

const dispatchKeyboardEvent = (
  element: HTMLElement,
  key: string,
  type: string,
): void => {
  element.dispatchEvent(
    new KeyboardEvent(type, {
      bubbles: true,
      composed: true,
      key,
    }),
  );
};

const focusEditableElement = (element: EditableElement): void => {
  if (document.activeElement === element) {
    return;
  }

  element.focus({
    preventScroll: true,
  });
};

const getControlSelection = (
  element: HTMLInputElement | HTMLTextAreaElement,
): { start: number; end: number; supportsRangeText: boolean } => {
  try {
    return {
      start:
        typeof element.selectionStart === "number"
          ? element.selectionStart
          : element.value.length,
      end:
        typeof element.selectionEnd === "number"
          ? element.selectionEnd
          : element.value.length,
      supportsRangeText: typeof element.setRangeText === "function",
    };
  } catch {
    return {
      start: element.value.length,
      end: element.value.length,
      supportsRangeText: false,
    };
  }
};

const applyTextToControl = (
  element: HTMLInputElement | HTMLTextAreaElement,
  text: string,
): void => {
  focusEditableElement(element);

  const { start, end, supportsRangeText } = getControlSelection(element);

  if (supportsRangeText) {
    element.setRangeText(text, start, end, "end");
  } else {
    element.value = `${element.value.slice(0, start)}${text}${element.value.slice(end)}`;
  }

  dispatchInputEvent(
    element,
    text === "\n" ? "insertLineBreak" : "insertText",
    text,
  );
};

const applyBackspaceToControl = (
  element: HTMLInputElement | HTMLTextAreaElement,
): void => {
  focusEditableElement(element);

  const { start, end, supportsRangeText } = getControlSelection(element);

  if (supportsRangeText && start !== end) {
    element.setRangeText("", start, end, "end");
  } else if (supportsRangeText && start > 0) {
    element.setRangeText("", start - 1, start, "end");
  } else if (start !== end) {
    element.value = `${element.value.slice(0, start)}${element.value.slice(end)}`;
  } else if (start > 0) {
    element.value = `${element.value.slice(0, start - 1)}${element.value.slice(start)}`;
  } else {
    return;
  }

  dispatchInputEvent(element, "deleteContentBackward", null);
};

const restoreContentEditableSelection = (
  autodetection: KeyboardAutodetectionController,
): Selection | null => {
  const restoredSelection =
    autodetection.restoreActiveContentEditableSelection();
  return restoredSelection?.selection ?? null;
};

const applyTextToContentEditable = (
  autodetection: KeyboardAutodetectionController,
  element: HTMLElement,
  text: string,
): boolean => {
  const selection = restoreContentEditableSelection(autodetection);
  if (!selection) {
    return false;
  }

  const executed = document.execCommand?.(
    text === "\n" ? "insertLineBreak" : "insertText",
    false,
    text,
  );

  if (!executed) {
    if (selection.rangeCount === 0) {
      return false;
    }

    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  autodetection.syncContentEditableSelection();
  dispatchInputEvent(
    element,
    text === "\n" ? "insertLineBreak" : "insertText",
    text,
  );
  return true;
};

const applyBackspaceToContentEditable = (
  autodetection: KeyboardAutodetectionController,
  element: HTMLElement,
): boolean => {
  const selection = restoreContentEditableSelection(autodetection);
  if (!selection) {
    return false;
  }

  const executed = document.execCommand?.("delete", false);
  if (!executed) {
    if (selection.rangeCount === 0) {
      return false;
    }

    const range = selection.getRangeAt(0);
    if (!range.collapsed) {
      range.deleteContents();
    } else {
      range.setStart(range.startContainer, Math.max(0, range.startOffset - 1));
      range.deleteContents();
    }
    selection.removeAllRanges();
    selection.addRange(range);
  }

  autodetection.syncContentEditableSelection();
  dispatchInputEvent(element, "deleteContentBackward", null);
  return true;
};

export const createKeyboardActionController = (
  autodetection: KeyboardAutodetectionController,
): KeyboardActionController => ({
  applyAction(action) {
    const element = autodetection.getLiveEditableElement();
    if (!element) {
      autodetection.clearActiveEditableElement();
      return false;
    }

    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement
    ) {
      switch (action.type) {
        case "insertText":
          applyTextToControl(element, action.text);
          autodetection.scheduleFocusStateRefresh();
          return true;
        case "backspace":
          applyBackspaceToControl(element);
          autodetection.scheduleFocusStateRefresh();
          return true;
        case "enter":
          if (element instanceof HTMLTextAreaElement) {
            applyTextToControl(element, "\n");
          } else {
            focusEditableElement(element);
            dispatchKeyboardEvent(element, "Enter", "keydown");
            dispatchKeyboardEvent(element, "Enter", "keypress");
            element.form?.requestSubmit();
            dispatchKeyboardEvent(element, "Enter", "keyup");
          }
          autodetection.scheduleFocusStateRefresh();
          return true;
      }
    }

    if (!(element instanceof HTMLElement) || !element.isContentEditable) {
      return false;
    }

    switch (action.type) {
      case "insertText":
        if (!applyTextToContentEditable(autodetection, element, action.text)) {
          return false;
        }
        autodetection.scheduleFocusStateRefresh();
        return true;
      case "backspace":
        if (!applyBackspaceToContentEditable(autodetection, element)) {
          return false;
        }
        autodetection.scheduleFocusStateRefresh();
        return true;
      case "enter":
        if (!applyTextToContentEditable(autodetection, element, "\n")) {
          return false;
        }
        autodetection.scheduleFocusStateRefresh();
        return true;
    }
  },
});
