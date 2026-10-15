# @edenapp/solid-kit

High-level SolidJS UI utilities for Eden renderer apps.

## Sidebars

`@edenapp/solid-kit/sidebar` wraps EdenCSS sidebar classes with Solid components.
EdenCSS supplies the styles; the components manage folding, accessible controls,
and navigation markup. Eden apps already receive the stylesheet automatically.

```tsx
import { Sidebar, SidebarItem, SidebarSection } from "@edenapp/solid-kit/sidebar";
import { FiHome } from "solid-icons/fi";

<Sidebar
  label="Navigation"
  heading="Places"
  size="compact"
  toggleLabels={{ collapse: "Collapse sidebar", expand: "Expand sidebar" }}
>
  <SidebarSection>
    <SidebarItem
      icon={<FiHome />}
      label="Home"
      selected={currentPage() === "home"}
      aria-current={currentPage() === "home" ? "page" : undefined}
      onClick={() => setCurrentPage("home")}
    />
  </SidebarSection>
</Sidebar>
```

Pass localized labels from your app. Items retain their accessible names and
tooltips when folded. `SidebarSection` accepts an optional `title`;
`SidebarDivider` separates sections. `SidebarItem` supports `description`,
`disabled`, and an optional `action` containing a `SidebarItemAction`. Action
buttons show an ellipsis when expanded and a corner dot when folded; supply
their accessible label and click handler in the app.

Use the optional `footer` slot for activity or controls that should stay visible
while the navigation list scrolls. It inherits the sidebar's folded styling.

Sidebars automatically fold at viewport widths of 760px or less until the user
toggles them. A deliberate choice lasts for the component's lifetime, including
window resizes. Set `collapseBelow={0}` to disable the responsive default or
`defaultCollapsed` to choose an initial state. For app-managed state, pass
`collapsed` and `onCollapsedChange`. Sizes are `default` (280px), `compact`
(240px), and `wide` (320px); all fold to a 72px icon rail. Standard DOM attributes,
event handlers, `class`, and `classList` remain available.

## Operation progress

Create an observer in your component, submit work through `run`, and render its
pending state and snapshots. `run` returns the typed completion result; thrown
failures can be displayed by your app's error UI. It stops observing when the
component is disposed while accepted work continues in Eden.

```tsx
import { fs } from "@edenapp/client";
import { createOperation, OperationStatus } from "@edenapp/solid-kit";
import { Show } from "solid-js";

function CopyButton() {
  const copy = createOperation();
  const startCopy = async () => {
    try {
      await copy.run(() => fs.cp(
        { volume: "home", path: "/report.pdf" },
        { volume: "home", path: "/backup/report.pdf" },
      ));
    } catch (error) {
      // Display the error in the app's UI.
    }
  };
  return <>
    <button class="eden-btn" disabled={copy.pending()} onClick={startCopy}>
      Copy report
    </button>
    <Show when={copy.pending()}>
      <OperationStatus label="Copying report…" snapshot={copy.snapshot()} />
    </Show>
  </>;
}
```

`OperationStatus` uses EdenCSS and shows a percentage when progress includes a
positive total, or a spinner otherwise. Pass a localized `description` to show
the current stage or formatted quantities. Progress reports contain raw numbers
and units so apps can format transferred bytes as KB, MB, GB, or TB.

For cancellable operations (`snapshot().cancellable`), call `cancel()` to request
a stop. `run()` remains pending until cleanup finishes, then rejects with an
`AbortError` when cancelled. Filesystem copies remove incomplete destinations and
restore overwritten files before reaching the `cancelled` status.

## Dialogs

`@edenapp/solid-kit/dialogs` provides local, in-renderer dialogs with a tiny promise API.

```ts
import { createDialogs, DialogHost } from "@edenapp/solid-kit/dialogs";

const dialogs = createDialogs();

// In app root JSX:
// <DialogHost dialogs={dialogs} />

const confirmed = await dialogs.confirm({
  title: "Delete",
  message: "Delete this file?",
  tone: "danger",
});
```

Declarative forms are available so app code stays classless/markup-light.

```ts
import { createDialogs, field } from "@edenapp/solid-kit/dialogs";

const dialogs = createDialogs();

const result = await dialogs.form({
  title: "New Contact",
  confirmLabel: "Save",
  fields: [
    field.text("firstName", "First Name", { required: true, autofocus: true }),
    field.text("lastName", "Last Name", { required: true }),
    field.email("email", "Email"),
  ] as const,
});

// result -> { firstName: string; lastName: string; email: string } | null
```
