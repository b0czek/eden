# @edenapp/solid-kit

High-level SolidJS UI utilities for Eden renderer apps.

## Eden components

The package exports Eden-styled, Kobalte-backed Solid components. Kobalte supplies accessible keyboard and focus behavior while EdenCSS supplies the visual contract; callers can still pass normal Kobalte props, refs, events, `as`, and classes.

```tsx
import { Button, Card, Dialog, Tabs } from "@edenapp/solid-kit";

<Card variant="glass">
  <Card.Header>
    <Card.Title>Account</Card.Title>
  </Card.Header>
  <Card.Body>
    <Tabs defaultValue="details">
      <Tabs.List>
        <Tabs.Trigger value="details">Details</Tabs.Trigger>
        <Tabs.Trigger value="security">Security</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="details">...</Tabs.Content>
    </Tabs>
  </Card.Body>
</Card>;

<Dialog>
  <Dialog.Trigger as={Button} variant="primary">Open</Dialog.Trigger>
  <Dialog.Portal>
    <Dialog.Overlay />
    <Dialog.Content>
      <Dialog.Title>Confirm</Dialog.Title>
      <Dialog.Description>Review the action before continuing.</Dialog.Description>
      <Dialog.CloseButton>Close</Dialog.CloseButton>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog>;
```

Plain component exports include `Button`, `TextField`, `Select`, `Checkbox`, `Switch`, `RadioGroup`, `Slider`, `Tabs`, `Dialog`, `AlertDialog`, `Tooltip`, `Popover`, and `Progress`. The rest of the EdenCSS semantic catalog is available as `Card`, `InfoCard`, `StatsCard`, `Badge`, `Tag`, `Avatar`, `List`, `Steps`, `Sidebar`, `Alert`, `Spinner`, `Skeleton`, `ButtonGroup`, `FAB`, and `IconButton`.

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
