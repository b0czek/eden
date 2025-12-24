# Eden Toaster

A toast notification overlay system for Eden that displays notifications in the bottom-right corner of the screen.

## Features

### Notification Types

Notifications support different visual types with color-coded progress bars:

- **info** (default) - Blue accent
- **success** - Green accent
- **warning** - Yellow/amber accent
- **danger** - Red accent

### Visual Design

- Responsive sizing - toasts expand to fit content
- Maximum toast height of 400px with ellipsis for long messages
- Title truncation with ellipsis for long titles (single line)
- Message text wraps and clamps at ~15 lines

### Queue-Based System

- **FIFO ordering** - Oldest notifications are shown first
- **Smart queueing** - When display area is full, new notifications queue up
- **Automatic dequeue** - When a visible toast is dismissed, the next queued toast appears

### Timeout & Pause Behavior

- Each notification has a configurable timeout (default: 5 seconds)
- **Persistent notifications** - Set `timeout: 0` (or omit) to keep until manually dismissed
- **Hover pause** - Hovering over a toast pauses its timer and progress bar
- Progress bar visually shows remaining time (not shown for persistent notifications)

### Interactive Elements

- **Dismiss button** (×) - Click to immediately dismiss a toast
- **Dismiss All button** - Appears when 2+ notifications exist, shows total count, clears all visible and queued toasts
- **Hover interaction** - Pauses timer on mouse enter, resumes on mouse leave

## Configuration

The toaster is configured in `toaster.ts`:

```typescript
const CONFIG = {
  corner: "bottom-right", // Position: top-left, top-right, bottom-left, bottom-right
  toastWidth: 320, // Toast width in pixels
  spacing: 16, // Gap between toasts
  marginX: 16, // Horizontal margin from screen edge
  marginY: 96, // Vertical margin from screen edge
};
```

## Usage

Push notifications from any Eden app:

```typescript
// Basic notification
window.edenAPI.shellCommand("notification/push", {
  title: "Hello",
  message: "This is a notification",
});

// With type
window.edenAPI.shellCommand("notification/push", {
  title: "Success!",
  message: "Operation completed successfully",
  type: "success",
});

// With custom timeout (ms)
window.edenAPI.shellCommand("notification/push", {
  title: "Warning",
  message: "This will stay for 10 seconds",
  type: "warning",
  timeout: 10000,
});

// Persistent notification (no auto-dismiss)
window.edenAPI.shellCommand("notification/push", {
  title: "Action Required",
  message: "This stays until you click × to dismiss",
  type: "danger",
  timeout: 0, // 0 or omit for persistent
});
```
