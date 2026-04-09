import type {
  EdenKeyboardTarget,
  EdenKeyboardTargetBounds,
} from "@edenapp/types";

export type EditableElement =
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLElement;

const SUPPORTED_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "password",
  "tel",
  "url",
  "number",
]);

const isSupportedInput = (element: HTMLInputElement): boolean => {
  if (element.disabled || element.readOnly) {
    return false;
  }

  const type = (element.type || "text").toLowerCase();
  return SUPPORTED_INPUT_TYPES.has(type);
};

export const isEditableElement = (
  value: EventTarget | Element | null,
): value is EditableElement => {
  if (!(value instanceof HTMLElement)) {
    return false;
  }

  if (value instanceof HTMLTextAreaElement) {
    return !value.disabled && !value.readOnly;
  }

  if (value instanceof HTMLInputElement) {
    return isSupportedInput(value);
  }

  return value.isContentEditable;
};

export const getKeyboardTarget = (
  element: EditableElement,
): EdenKeyboardTarget => {
  if (element instanceof HTMLTextAreaElement) {
    return {
      kind: "textarea",
      multiline: true,
      inputType: null,
      inputMode: element.inputMode || null,
      enterKeyHint: element.enterKeyHint || null,
    };
  }

  if (element instanceof HTMLInputElement) {
    return {
      kind: "input",
      multiline: false,
      inputType: element.type || "text",
      inputMode: element.inputMode || null,
      enterKeyHint: element.enterKeyHint || null,
    };
  }

  return {
    kind: "contenteditable",
    multiline: true,
    inputType: null,
    inputMode: element.inputMode || null,
    enterKeyHint: element.enterKeyHint || null,
  };
};

export const getEditableElementBounds = (
  element: EditableElement,
): EdenKeyboardTargetBounds => {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
};
