import type {
  EdenKeyboardLayout,
  EdenKeyboardTarget,
  EdenKeyboardTargetBounds,
  ViewBounds,
} from "@edenapp/types";

const KEYBOARD_TOP_MARGIN = 16;
const KEYBOARD_BOTTOM_MARGIN = 16;
const DOCKED_HORIZONTAL_MARGIN = 16;
const KEYBOARD_DESIRED_WIDTH = 960;
const KEYBOARD_MIN_WIDTH = 420;
export const KEYBOARD_COMPACT_DESIRED_WIDTH = 360;
export const KEYBOARD_COMPACT_MIN_WIDTH = 320;
const KEYBOARD_ROW_HEIGHT = 48;
const KEYBOARD_ROW_GAP = 6;
const KEYBOARD_VERTICAL_PADDING = 20;

export type KeyboardGeometryOptions = {
  rowCount: number;
  scale: number;
  desiredWidth?: number;
  minWidth?: number;
};

const clampScale = (scale: number): number => {
  if (!Number.isFinite(scale)) {
    return 1;
  }

  return Math.max(0.5, Math.min(scale, 2));
};

const calculateKeyboardSize = (
  availableWidth: number,
  { rowCount, scale, desiredWidth, minWidth }: KeyboardGeometryOptions,
  extraHeight = 0,
): Pick<ViewBounds, "width" | "height"> => {
  const boundedScale = clampScale(scale);
  const safeRowCount = Math.max(1, rowCount);
  const baseDesiredWidth = desiredWidth ?? KEYBOARD_DESIRED_WIDTH;
  const baseMinWidth = minWidth ?? KEYBOARD_MIN_WIDTH;
  const scaledDesiredWidth = Math.round(baseDesiredWidth * boundedScale);
  const scaledMinWidth = Math.round(baseMinWidth * boundedScale);
  const width = Math.max(
    Math.min(scaledMinWidth, availableWidth),
    Math.min(availableWidth, scaledDesiredWidth),
  );
  const height = Math.round(
    (safeRowCount * KEYBOARD_ROW_HEIGHT +
      (safeRowCount - 1) * KEYBOARD_ROW_GAP +
      KEYBOARD_VERTICAL_PADDING +
      extraHeight) *
      boundedScale,
  );

  return { width, height };
};

export const resolveWorkspaceBounds = (
  contentBounds: ViewBounds,
  workspaceBounds: ViewBounds | null,
): ViewBounds => {
  return (
    workspaceBounds ?? {
      x: 0,
      y: 0,
      width: contentBounds.width,
      height: contentBounds.height,
    }
  );
};

export const calculateDockedKeyboardBounds = (
  contentBounds: ViewBounds,
  _workspaceBounds: ViewBounds | null,
  options: KeyboardGeometryOptions,
): ViewBounds => {
  const availableWidth = Math.max(
    1,
    contentBounds.width - DOCKED_HORIZONTAL_MARGIN * 2,
  );
  const { width, height } = calculateKeyboardSize(availableWidth, options);
  const x = contentBounds.x + Math.round((contentBounds.width - width) / 2);
  const y = contentBounds.y + contentBounds.height - height;

  return { x, y, width, height };
};

export const calculateDefaultFloatingKeyboardBounds = (
  contentBounds: ViewBounds,
  workspaceBounds: ViewBounds | null,
  options: KeyboardGeometryOptions,
): ViewBounds => {
  const bounds = resolveWorkspaceBounds(contentBounds, workspaceBounds);
  const availableWidth = Math.max(1, bounds.width - 24);
  const { width, height } = calculateKeyboardSize(availableWidth, options);
  const x = contentBounds.x + bounds.x + Math.round((bounds.width - width) / 2);
  const y = contentBounds.y + bounds.y + bounds.height - height - 12;

  return { x, y, width, height };
};

export const calculateKeyboardLayout = (
  target?: EdenKeyboardTarget,
): EdenKeyboardLayout => {
  const inputType = target?.inputType?.toLowerCase();
  const inputMode = target?.inputMode?.toLowerCase();

  if (
    inputMode === "numeric" ||
    inputMode === "decimal" ||
    inputType === "number"
  ) {
    return "number";
  }

  return "text";
};

export const calculateDockedKeyboardLift = ({
  keyboardHeight,
  targetBounds,
  viewBounds,
  contentBounds,
}: {
  keyboardHeight: number;
  targetBounds?: EdenKeyboardTargetBounds;
  viewBounds?: ViewBounds;
  contentBounds: ViewBounds;
}): number => {
  if (!targetBounds || !viewBounds || keyboardHeight <= 0) {
    return 0;
  }

  const targetTop = viewBounds.y + targetBounds.y;
  const targetBottom = targetTop + targetBounds.height;
  const visibleTop = KEYBOARD_TOP_MARGIN;
  const visibleBottom =
    contentBounds.height - keyboardHeight - KEYBOARD_BOTTOM_MARGIN;

  const requiredLift = Math.max(0, targetBottom - visibleBottom);
  if (requiredLift <= 0) {
    return 0;
  }

  const maxLiftBeforeTopClips = Math.max(0, targetTop - visibleTop);
  return Math.min(requiredLift, maxLiftBeforeTopClips);
};
