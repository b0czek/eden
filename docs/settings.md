# Adding Settings

Eden can display settings declared by an app manifest or a trusted Electron host. Use manifest settings for ordinary persisted preferences. Use a host panel when the current view or its actions depend on main-process resources.

## App Manifest Settings

Add a `settings` array to the app's `manifest.json`:

```json
{
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

Supported types are `text`, `number`, `checkbox`, `radio`, `select`, `toggle`, `textarea`, `color`, and `range`. Values are stored as strings. The owning app uses `settings/get`, `settings/set`, `settings/get-all`, and `settings/reset` with the `settings/rw` permission. A setting is visible when the active user has `settings/<appId>/<setting.grant-or-key>`.

## Host-Registered Panels

A registration contains stable metadata and action declarations. Its loader returns the complete resolved generic view on every call:

```ts
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
    load: async () => ({
      sections: [{
        id: "connection",
        nodes: [{
          kind: "toggle",
          id: "enabled",
          label: { en: "Enabled", pl: "Włączone" },
          value: await readEnabled(),
          action: { actionId: "set-enabled" },
        }],
      }],
    }),
    actions: {
      "set-enabled": async ({ value }) => {
        await writeEnabled(value as boolean);
      },
    },
  },
);
```

Generic sections contain `nodes`. Supported nodes are resolved status rows, toggles, buttons, inputs, dialogs, and collections. A loader expresses dynamic visibility by omitting a node from its next snapshot; interactive nodes use `disabled` when they should remain visible but unavailable. Select and radio nodes include their current options.

Call `registration.invalidate()` after host-owned state changes outside a panel action. If the panel is selected, Settings reloads only that panel's complete snapshot; it does not reload the catalog. Settings reconciles sections and sibling nodes by stable ID. Collection items and their row nodes are likewise reconciled within their containers, so unchanged components and compatible dialog drafts survive refreshes. Reusing an ID with another node or input kind replaces that local component state.

The registration also supports `setVisible(boolean)` and `unregister()`. Hidden panels cannot be discovered, loaded, or acted on, although their grants remain in the administrative grant catalog.

## Action Envelopes

Action bindings separate the handler from the node instance and may include public parameters:

```ts
{
  kind: "button",
  id: "remove",
  label: "Remove",
  action: {
    actionId: "remove-device",
    params: { deviceId: "opaque-device-id" },
  },
}
```

Declare each accepted channel independently:

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

Buttons invoke `{ params }`; toggles and inputs invoke `{ params, value }`; dialogs invoke `{ params, fields }`. Empty members are omitted, and provider parameters are never flattened into or merged with user values. An absent channel schema forbids that invocation member.

Bindings and invocations are both validated. Parameters are still client-visible and tamperable, and referenced resources can disappear after a snapshot loads, so handlers must reauthorize the resource and operation immediately before making changes.

An action may declare an additional `grant`. Such an action must have a stable `label`, because the grant catalog is generated without loading providers. Unauthorized generated manifest settings are omitted. Unauthorized host action nodes remain visible but disabled.

## Collections

A collection resolves each row and its available operations directly:

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
      action: {
        actionId: "remove-device",
        params: { deviceId: device.id },
      },
    }],
  })),
}
```

Rows may contain status, button, toggle, and dialog nodes. Direct row inputs, nested collections, and arbitrary recursive layouts are not supported.

IDs must be unique within their scope: sections within a view, nodes among siblings, items within a collection, and row nodes within an item.

## Dialogs and Passwords

Dialog fields carry resolved initial values and current select/radio options. Compatible non-secret drafts survive snapshot refreshes while removed fields and fields whose input kind changed are reset.

Password fields are allowed only in dialogs and cannot have a provider-supplied initial value. Settings clears password drafts after every submission attempt, close, node replacement, and unmount. Providers must never return passwords in snapshots.

## Nested Panels

Set `parentId` on independently registered children and register the parent first. Root panels appear in the sidebar; children appear inside their parent with back and breadcrumb navigation at arbitrary depth.

The active user must be authorized for the selected panel and every ancestor. Parent and child must share an ownership domain: host with host, Eden with Eden, or the same application owner. A public registration cannot be unregistered while descendants remain; unregister descendants first. Registration lifetimes never cascade through the public host API.

For a host navigation category with no controls or grant of its own, register an empty parent panel first:

```ts
const parent = eden.settings.registerPanel(
  { id: "acme.device", title: { en: "Device", pl: "Urządzenie" } },
  { load: () => ({ sections: [] }) },
);
eden.settings.registerPanel(
  {
    id: "acme.display",
    parentId: parent.panelId,
    title: { en: "Display", pl: "Ekran" },
    grant: "settings-panels/acme.display",
  },
  displayProvider,
);
```

Omitting `grant` adds no permission check for that panel. A root without a grant is public; a child without a grant inherits its ancestors' access requirements. A child with its own grant must satisfy that grant as well as its ancestors' grants. The empty parent remains visible even when none of its children are accessible.
