# @edenapp/solid-kit

High-level SolidJS UI utilities for Eden renderer apps.

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
