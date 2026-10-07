# @edenapp/solid-kit

High-level SolidJS UI utilities for Eden renderer apps.

## Operation progress

Create an observer in your component, submit work through `run`, and render its
pending state and snapshots. `run` returns the typed completion result; thrown
failures can be displayed by your app's error UI. It stops observing when the
component is disposed while accepted work continues in Eden.

```tsx
import { createOperation, OperationStatus } from "@edenapp/solid-kit";
import { Show } from "solid-js";

function CopyButton() {
  const copy = createOperation();
  const startCopy = async () => {
    try {
      await copy.run(() => window.edenAPI.shellCommand("fs/cp", {
        from: { volume: "home", path: "/report.pdf" },
        to: { volume: "home", path: "/backup/report.pdf" },
      }));
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
