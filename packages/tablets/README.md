# @edenapp/tablets

Tiny renderer toolkit for Eden apps. It provides runtime helpers for Eden’s system context menu, file picker, and notifications without wiring IPC directly.

## What it does

- Provides `contextMenu` runtime helper for opening/closing menus.
- Provides `filePicker` async helpers for opening and saving file paths.
- Provides `notification` helpers with automatically routed action callbacks.
- Provides menu builder helpers (`menu`, `button`, `title`, `separator`, `when`).

## Install

```bash
pnpm add @edenapp/tablets
```

```bash
npm install @edenapp/tablets
```

```bash
yarn add @edenapp/tablets
```

## Basic usage

```ts
import { contextMenu, menu, button, title } from "@edenapp/tablets";

const appMenu = menu((app: { id: string; name: string }) => [
  title(app.name),
  button("open", "Open", () => console.log("open", app.id)),
  button("remove", "Remove", () => console.log("remove", app.id), {
    danger: true,
  }),
]);

// Build a standard HTML/JS onContextMenu event handler for your component/element
const onContextMenu = appMenu.handler({
  id: "com.example.app",
  name: "Example",
});

// Example usage (React/Solid/JSX):
// <div onContextMenu={onContextMenu}>Right-click me</div>

// Or open at a specific position
void appMenu.show(
  { id: "com.example.app", name: "Example" },
  { left: 120, top: 80 },
);

// Close the active menu
void contextMenu.close();
```

## File picker

```ts
import { filePicker } from "@edenapp/tablets";

const path = await filePicker.openFile({
  title: "Open Markdown",
  filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
});

const savePath = await filePicker.saveFile({
  suggestedName: "notes.md",
  filters: [{ name: "Markdown", extensions: ["md"] }],
});
```

## Notifications

```ts
import { notification } from "@edenapp/tablets";

await notification.push("Saved", "Your changes were saved.", {
  type: "success",
});

await notification.push(
  "Update ready",
  "Restart to apply the update.",
  [
    {
      label: "Restart",
      onClick: async () => restartApp(),
    },
    {
      label: "Later",
      dismissOnClick: false,
      onClick: () => scheduleReminder(),
    },
  ],
  { timeout: 10_000 },
);
```

Tablets generates action IDs and routes clicks back to the callback that created
each action. Actions dismiss the notification after a click by default. Set
`dismissOnClick: false` to keep the action active until the notification closes.
