# Add settings

[Handbook](README.md) · Related: [Users and grants](users.md), [Host API](main-process-api.md)

Use manifest settings for an app's saved preferences.
Use a host panel when controls depend on main-process resources or host actions.
Both appear in the built-in Settings app.

## App manifest settings

Add a `settings` array and `settings/rw` permission to the app manifest:

```json
{
  "permissions": ["settings/rw"],
  "settings": [{
    "id": "general",
    "name": { "en": "General", "pl": "Ogólne" },
    "settings": [{
      "key": "enabled",
      "label": { "en": "Enabled", "pl": "Włączone" },
      "type": "toggle",
      "defaultValue": "false"
    }]
  }]
}
```

Eden creates the panel `app.<appId>` from these declarations.
The active user needs `settings/<appId>/<setting.grant-or-key>` to see a field.
If `grant` is absent, Eden uses the setting key.

Read and change values from app code:

```ts
import { settings } from "@edenapp/client";

const { value } = await settings.get("enabled");
const enabled = value === "true";
await settings.set("enabled", "true");
await settings.reset("enabled");
```

Values are strings, including booleans and numbers.
`getAll()` returns the app's settings. Subscribe to `settings/changed` for updates.
Commands use the calling app's namespace.
A setting can declare `sharedWith` app IDs for read access through `settings.get(key, { appId })`.

Supported field types are `text`, `number`, `checkbox`, `radio`, `select`,
`toggle`, `textarea`, `color`, and `range`.
Select and radio fields declare `options` with stored values and display labels.
See [setting types](../packages/types/AppManifest.d.ts) for ranges, defaults, and sharing fields.

## Host-registered panels

Register a panel from the Electron main process.
You can register before `whenReady()` or later while Eden is running.
The loader and action handlers return Effects.
Install Effect as a direct dependency as described in the [host guide](main-process-api.md#execute-host-work).

This example keeps a toggle in memory for the current runtime:

```ts
import { createEden } from "@edenapp/sdk";
import * as Effect from "effect/Effect";

const eden = createEden();
let enabled = false;

const registration = eden.settings.registerPanel(
  {
    id: "acme.network",
    title: { en: "Network", pl: "Sieć" },
    grant: "settings-panels/acme.network",
    actions: [{
      id: "set-enabled",
      value: { type: "boolean", required: true },
    }],
  },
  {
    load: () => Effect.sync(() => ({
      sections: [{
        id: "connection",
        nodes: [{
          kind: "toggle",
          id: "enabled",
          label: "Enabled",
          value: enabled,
          action: { actionId: "set-enabled" },
        }],
      }],
    })),
    actions: {
      "set-enabled": ({ value }) => Effect.sync(() => {
        enabled = value as boolean;
      }),
    },
  },
);
```

For a real device, replace the in-memory read and write with your host adapter's Effects.
Keep callbacks and host resources in the main process.
Return only public display data from the loader.

Each load returns the complete current view.
Sections contain status rows, toggles, buttons, inputs, dialogs, or collections.
Omit a node when it should be hidden. Use `disabled` when it should remain visible but unavailable.
Resolve select/radio options in the returned view.

## Refresh and release a panel

Call `registration.invalidate()` after a host change outside a panel action.
Settings reloads the selected panel without reloading the panel catalog.
Use stable IDs so controls and compatible dialog drafts survive refreshes.
Changing a node's kind resets its local component state.

`setVisible(false)` hides a panel and blocks loading and actions.
Its grants remain in the administrative grant catalog.
`unregister()` releases the registration.
Eden disposal also releases registrations.

IDs must be unique within their container: sections within a view, sibling nodes,
items within a collection, and row nodes within an item.

## Bind an action to a resource

Declare accepted parameters and values separately:

```ts
{
  id: "rename-device",
  params: {
    type: "object",
    required: true,
    properties: { deviceId: { type: "string", required: true } },
    additionalProperties: false,
  },
  value: { type: "string", required: true },
}
```

A node binds that action to a resource:

```ts
{
  kind: "input",
  id: "name",
  input: "text",
  label: "Name",
  value: device.name,
  action: { actionId: "rename-device", params: { deviceId: device.id } },
}
```

Buttons submit `params`. Toggles and inputs submit `params` and `value`.
Dialogs submit `params` and `fields`.
An omitted channel schema forbids that channel in the invocation.
Eden validates both bindings and submitted data.

Parameters are visible to the client and can be changed there.
Recheck resource access and current resource state in the action handler before mutation.
A resource can disappear after the panel loads.

An action can require its own `grant`.
Supply a stable action `label` when declaring that grant.
Unauthorized host action nodes remain visible but disabled.
Unauthorized manifest settings are omitted.

## Show a collection

Resolve row content and operations in the loader:

```ts
{
  kind: "collection",
  id: "devices",
  label: "Devices",
  items: devices.map((device) => ({
    id: device.id,
    title: device.name,
    badge: { label: device.online ? "Online" : "Offline" },
    nodes: [{
      kind: "button",
      id: "remove",
      label: "Remove",
      disabled: !device.removable,
      action: { actionId: "remove-device", params: { deviceId: device.id } },
    }],
  })),
}
```

Rows support status, button, toggle, and dialog nodes.
Use dialogs for row editing.

## Use dialogs and password fields

Resolve initial values and current select/radio options in the loader.
Compatible non-secret drafts survive refreshes.
Removed fields and changed input kinds reset their drafts.

Password fields belong in dialogs and cannot have a provider-supplied initial value.
Settings clears password drafts after submission attempts, close, replacement, and unmount.
Never return passwords in a panel snapshot.

## Group panels

Register a parent before its children. Set each child's `parentId` to the parent registration's `panelId`.
Root panels appear in the sidebar; children appear within their parent.

```ts
const parent = eden.settings.registerPanel(
  { id: "acme.device", title: "Device" },
  { load: () => Effect.succeed({ sections: [] }) },
);
```

A child registration can then use `parentId: parent.panelId`.
The active user needs access to the selected panel and all ancestors.
Omitting `grant` adds no extra check: an unguarded root is public,
and an unguarded child still requires access to its ancestors.
An empty parent stays visible even when no child is accessible.

Unregister children before their parent.
Public registration cleanup does not cascade to descendants.
See the [host Settings contracts](../packages/sdk/src/api/settings.ts) and
[panel view types](../packages/types/SettingsPanel.d.ts) for complete schemas.
