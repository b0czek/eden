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

## Notices

`@edenapp/solid-kit/notices` shows notices inside the app window, at the top
centre below the app frame. Use them for failures of actions that the user
started in the app, and for problems that the app observes. Use the toaster
(`notification` from `@edenapp/tablets`) for failures that are not owned by
one app.

Wrap the app in `NoticeProvider` and pass localized labels:

```tsx
import { NoticeProvider, useNotices } from "@edenapp/solid-kit/notices";

<NoticeProvider
  labels={{
    dismiss: t("common.dismiss"),
    showMore: (hidden) => t("notices.showMore", { count: hidden }),
    showLess: t("notices.showLess"),
  }}
>
  <App />
</NoticeProvider>
```

Report notices with `useNotices()`:

```tsx
const notices = useNotices();

// A failure of an action. It stays until the user dismisses it.
notices.report({
  severity: "danger",
  title: t("offsets.writeFailed"),
  detail: reason,
  key: "offset:G54:X",
});

// Run an action. When it throws, the error is logged and reported.
const file = await notices.attempt(() => openFile(path), {
  title: t("program.openFailed"),
});

// A problem that lasts while the condition is true. Call it in a component
// body, not after an `await` or in an event handler.
notices.condition(() => !connected(), {
  severity: "warning",
  title: t("connection.lost"),
});
```

Severities match notification types: `danger`, `warning`, `info`, and
`success`. Danger and warning notices stay until the user dismisses them; info
and success notices hide after four seconds. A report with the `key` of a shown
notice replaces it in place and shows a count. Notices are listed most severe first;
within a severity, condition notices come first. Condition notices have no
dismiss button and clear when their condition is false or their owner is
disposed. Three notices are visible at a time; a button shows the others.
Screen readers announce danger notices immediately and other notices politely.

## Date and time fields

`@edenapp/solid-kit/datetime` lets the user choose a date and time by touch.
`DateTimeField` shows its value on a button. The button opens steppers for the
day, hour, and minute. Hold a stepper to repeat it. Minutes move in steps of
`minuteStep` (5 by default), and the field stays between `min` and `max`.

```tsx
import { DateTimeField } from "@edenapp/solid-kit/datetime";
import { locale, t } from "./i18n";

<DateTimeField
  label={t("logs.from")}
  value={from()}
  onChange={setFrom}
  placeholder={t("logs.anyTime")}
  max={new Date()}
  locale={locale()}
/>
```

Pass the app's Eden locale from `@edenapp/babel/solid`. The field formats its
value for that locale and has its own strings for each Eden locale.

The field's styles are part of this entry point, not EdenCSS, so only apps that
import it load them. The root `@edenapp/solid-kit` entry does not export it.

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
