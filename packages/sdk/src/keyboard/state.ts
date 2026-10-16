import type {
  EdenKeyboardDragInput,
  EdenKeyboardFocusState,
  EdenKeyboardPlacementMode,
  EdenKeyboardTarget,
  ViewBounds,
} from "@edenapp/types";

export interface KeyboardTargetSession {
  appId: string;
  viewId: number;
  sessionId: number;
  target?: EdenKeyboardTarget;
  targetBounds?: EdenKeyboardFocusState["targetBounds"];
  placementMode?: EdenKeyboardPlacementMode;
}

export interface KeyboardPreferences {
  enabled: boolean;
  autoShowOnFocus: boolean;
  placementMode: EdenKeyboardPlacementMode;
  showNumberRow: boolean;
  interfaceScale: number;
}

export interface KeyboardState {
  preferences: KeyboardPreferences;
  workspaceBounds: ViewBounds | null;
  currentTarget: KeyboardTargetSession | null;
  persistentVisibility: boolean;
  dismissedTarget: Pick<KeyboardTargetSession, "viewId" | "sessionId"> | null;
  floatingBounds: ViewBounds | null;
  visibilityRequested: boolean;
}

export interface KeyboardDragState {
  input: EdenKeyboardDragInput;
  startPoint: { x: number; y: number };
  startBounds: ViewBounds;
  lastX?: number;
  lastY?: number;
}
