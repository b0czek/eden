# Adding Settings

Eden's Settings application is schema-driven. The schema supplies navigation,
selection, labels, descriptions, visibility, and view selection for settings
and custom settings views.

## Eden System Settings

System-owned categories live in
`packages/sdk/src/settings/EdenSettings.ts` as entries in
`EDEN_SETTINGS_SCHEMA`.

A category rendered with the standard controls needs only schema data:

```ts
{
  id: "example",
  name: { en: "Example", pl: "Przykład" },
  icon: "settings",
  settings: [
    {
      key: "example.enabled",
      label: { en: "Enabled", pl: "Włączone" },
      type: "toggle",
      defaultValue: "false",
    },
  ],
}
```

The Settings app obtains this schema through `settings/schema`, renders the
category in its existing sidebar, loads values from the `com.eden` namespace,
and renders supported `SettingDefinition` types with `SettingsList` and
`SettingInput`.

Supported input types are `text`, `number`, `checkbox`, `radio`, `select`,
`toggle`, `textarea`, `color`, and `range`. Values are stored as strings.

## Custom System Views

Use a custom view when a category needs interactive behavior that cannot be
expressed as setting definitions. The category still belongs in
`EdenSettings.ts`:

```ts
{
  id: "daemons",
  name: { en: "Daemons", pl: "Demony" },
  description: {
    en: "Configure backend services.",
    pl: "Konfiguruj usługi backendowe.",
  },
  icon: "cpu",
  view: "daemons",
  grant: "preset/daemon/manage",
  grantScope: "global",
  settings: [],
}
```

Then register the view component once in `SettingsContent.tsx`:

```ts
const viewRegistry: Record<string, Component> = {
  daemons: DaemonsTab,
};
```

If the category uses a new icon name, add its mapping to the shared category
icon switch in `SettingsSidebar.tsx`. The frontend integration for a custom
category consists of its view-registry entry and, when needed, its shared icon
mapping.

## Grants

Grants control settings access.

- Define reusable permission bundles in
  `packages/sdk/src/grants/GrantPresetList.ts`.
- Declare the preset in the Settings app manifest when its custom view calls
  protected commands.
- Put the fully qualified grant key, such as `preset/daemon/manage`, on the
  system settings category and set `grantScope: "global"`.
- Let `SettingsManager.filterSchemaByGrants` remove inaccessible categories.
- Let `CommandRegistry` enforce permissions when the view calls commands.

`SettingsManager.filterSchemaByGrants` is the source of category visibility.
Vendor accounts satisfy grants through the normal grant system.

For an ordinary setting without `grantScope: "global"`, Settings uses its
setting-scoped access rules. A setting can provide an explicit `grant`; when it
does not, its setting key is used.

## App-Provided Settings

An app publishes ordinary settings in its `manifest.json` under `settings`.
The Settings app discovers manifests with non-empty settings schemas and renders
them without app-specific frontend code. The owning app uses the regular
`settings/get`, `settings/set`, `settings/get-all`, and `settings/reset`
commands, which are scoped to its own namespace and require `settings/rw`.

`sharedWith` names apps allowed to read a setting through the regular API.
Cross-namespace administration uses the Settings app's existing superuser flow.

## Persistence and Reactions

`SettingsManager` stores values under `{appId}:{key}` in `settings.db` and emits
`settings/changed` after writes. Managers react through the existing internal
subscription mechanism.

Custom operational data may use the same settings storage when appropriate,
but its UI category and access control must still follow the schema and grant
paths above.

## Checklist

1. Add or update the category schema.
2. Add localized schema labels and descriptions.
3. For a custom view, register only its view ID and shared icon mapping.
4. Define and declare any required grant preset.
5. Avoid role checks and feature-specific navigation state.
6. Regenerate command/event types if handlers or events changed.
7. Build the Settings app and run the relevant SDK tests and lint checks.
