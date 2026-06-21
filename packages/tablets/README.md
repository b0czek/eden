# @edenapp/tablets

Tiny renderer toolkit for Eden apps. It provides runtime helpers for Eden’s system context menu and file picker without wiring IPC directly.

## What it does

- Provides `contextMenu` runtime helper for opening/closing menus.
- Provides `filePicker` async helpers for opening and saving file paths.
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
