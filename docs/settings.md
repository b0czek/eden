# Adding Settings

Eden can display settings declared by an app manifest or a trusted Electron
host. Use manifest settings for ordinary app preferences. Use a host-registered
panel when settings need to load state from, or run actions in, the main
process.

## App Manifest Settings

Add a `settings` array to the app's `manifest.json`:

```json
{
  "settings": [
    {
      "id": "general",
      "name": { "en": "General", "pl": "Ogólne" },
      "settings": [
        {
          "key": "enabled",
          "label": { "en": "Enabled", "pl": "Włączone" },
          "type": "toggle",
          "defaultValue": "false"
        }
      ]
    }
  ]
}
```

The Settings app renders the declared categories and controls. Supported input
types are `text`, `number`, `checkbox`, `radio`, `select`, `toggle`, `textarea`,
`color`, and `range`. Values are stored as strings.

The owning app can read and update its values with `settings/get`,
`settings/set`, `settings/get-all`, and `settings/reset`. These commands require
the `settings/rw` permission. Use `sharedWith` on a setting when another app
needs read access.

Settings are shown only when the active user has
`settings/<appId>/<setting.grant-or-key>`. Set `grant` on a setting when its
permission key should differ from its setting key.

## Host-Registered Panels

An Electron host can register a panel on its `Eden` instance:

```ts
const eden = new Eden(config);

const registration = eden.settings.registerPanel(
  {
    id: "acme.network",
    title: { en: "Network", pl: "Sieć" },
    grant: "settings-panels/acme.network",
    sections: [
      {
        id: "connection",
        controls: [
          {
            kind: "toggle",
            id: "enabled",
            label: { en: "Enabled", pl: "Włączone" },
            stateKey: "enabled",
            actionId: "set-enabled",
          },
        ],
      },
    ],
    actions: [
      {
        id: "set-enabled",
        label: { en: "Change network state", pl: "Zmień stan sieci" },
        input: {
          type: "object",
          properties: {
            value: { type: "boolean", required: true },
          },
          additionalProperties: false,
        },
      },
    ],
  },
  {
    load: async () => ({
      controls: { enabled: { value: await readEnabled() } },
    }),
    actions: {
      "set-enabled": async (input) => {
        await writeEnabled((input as { value: boolean }).value);
      },
    },
  },
);
```

The declaration defines the panel's localized content, controls, actions, and
validation. The provider loads current state and handles the declared actions
in the main process. Keep declarations serializable and provide a handler for
every declared action.

Generic panels support localized sections, status rows, badges, toggles,
buttons, inputs, operation dialogs, validation constraints, password fields, and
per-control state. An action can declare an additional grant when it needs more
restricted access than the panel itself.

Use a dialog when an operation needs several values or a secret:

```ts
{
  kind: "dialog",
  id: "ftp-password",
  label: "FTP password",
  description: "Update the credential used by the FTP connection.",
  buttonLabel: "Update password",
  actionId: "update-ftp-password",
  dialog: {
    title: "Update FTP password",
    fields: [
      {
        id: "password",
        label: "FTP password",
        input: "password",
        autocomplete: "new-password",
        validation: { required: true, minLength: 8 },
      },
    ],
    submitLabel: "Save",
    cancelLabel: "Cancel",
  },
}
```

Use the registration handle to control the panel's lifetime:

```ts
registration.setVisible(false);
registration.setVisible(true);
registration.unregister();
```

A hidden panel cannot be opened or used, but administrators can still assign
its grants. Calling `unregister()` removes the panel.

Panel IDs must be unique. The `eden.` and `app.` prefixes are reserved. The
active user must have the panel grant and, when declared, the action grant.

## Handling Passwords

Use password fields only inside operation dialogs and submit them directly to an
action. A panel provider must not return or persist passwords. The Settings app
clears password input after submission or dismissal.
