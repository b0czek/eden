export type EdenKeyboardPlacementMode = "docked" | "floating";

export type EdenKeyboardLayout = "text" | "number" | "tel" | "email" | "url";

export interface EdenKeyboardTargetBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EdenKeyboardTarget {
  kind: "input" | "textarea" | "contenteditable";
  multiline: boolean;
  inputType?: string | null;
  inputMode?: string | null;
  enterKeyHint?: string | null;
}

export interface EdenKeyboardFocusState {
  visible: boolean;
  sessionId: number;
  target?: EdenKeyboardTarget;
  targetBounds?: EdenKeyboardTargetBounds;
}

export interface EdenKeyboardInsetState {
  visible: boolean;
  placementMode: EdenKeyboardPlacementMode;
  bottomInset: number;
}

export interface EdenKeyboardState extends EdenKeyboardInsetState {
  enabled: boolean;
  target?: EdenKeyboardTarget;
  layout: EdenKeyboardLayout;
  showNumberRow: boolean;
}

export type EdenKeyboardAction =
  | { type: "insertText"; text: string }
  | { type: "backspace" }
  | { type: "enter" };

export interface EdenKeyboardAPI {
  show(): Promise<{ success: boolean }>;
  sendAction(action: EdenKeyboardAction): Promise<{ success: boolean }>;
  hide(): Promise<{ success: boolean }>;
  getState(): Promise<EdenKeyboardState>;
  onStateChanged?(callback: (state: EdenKeyboardState) => void): () => void;
}
