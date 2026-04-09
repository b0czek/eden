import type {
  EdenKeyboardLayout,
  EdenKeyboardTarget,
  EdenKeyboardTargetBounds,
  ViewBounds,
} from "@edenapp/types";

const KEYBOARD_TOP_MARGIN = 16;
const KEYBOARD_BOTTOM_MARGIN = 16;
const DOCKED_HORIZONTAL_MARGIN = 16;
const DOCKED_MIN_WIDTH = 420;
const DOCKED_MAX_WIDTH_PER_HEIGHT = 3.4;

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
): ViewBounds => {
  const height = Math.max(
    220,
    Math.min(Math.round(contentBounds.height * 0.36), 320),
  );
  const maxAvailableWidth = Math.max(
    DOCKED_MIN_WIDTH,
    contentBounds.width - DOCKED_HORIZONTAL_MARGIN * 2,
  );
  const proportionalWidth = Math.round(height * DOCKED_MAX_WIDTH_PER_HEIGHT);
  const width = Math.min(
    maxAvailableWidth,
    Math.max(DOCKED_MIN_WIDTH, proportionalWidth),
  );
  const x = contentBounds.x + Math.round((contentBounds.width - width) / 2);
  const y = contentBounds.y + contentBounds.height - height;

  return { x, y, width, height };
};

export const calculateDefaultFloatingKeyboardBounds = (
  contentBounds: ViewBounds,
  workspaceBounds: ViewBounds | null,
): ViewBounds => {
  const bounds = resolveWorkspaceBounds(contentBounds, workspaceBounds);
  const width = Math.max(420, Math.min(bounds.width - 24, 1080));
  const height = Math.max(220, Math.min(Math.round(bounds.height * 0.32), 280));
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

  if (inputMode === "tel" || inputType === "tel") {
    return "tel";
  }

  if (inputType === "email") {
    return "email";
  }

  if (inputType === "url") {
    return "url";
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
