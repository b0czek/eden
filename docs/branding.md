# Set product branding

[Handbook](README.md) · Prerequisite: [Create a consumer](consumer-development.md)

Set `branding` in the consumer's runtime configuration:

```ts
import { createEden } from "@edenapp/sdk";

const eden = createEden({
  branding: {
    name: "Acme Workspace",
    logoPath: "assets/acme-logo.svg",
    iconPath: "assets/acme-icon.png",
  },
});
```

| Field | Use | Formats |
| --- | --- | --- |
| `name` | Product name in SDK interfaces and the default window title | Text; required when `branding` is supplied |
| `logoPath` | Login screen logo | SVG, PNG, JPEG, WebP |
| `iconPath` | Native main-window icon | PNG, ICO |

`window.title` overrides the window title derived from `branding.name`.
Relative paths resolve from Electron's application directory, `app.getAppPath()`.
Absolute paths are also accepted for development.
Include the assets in the packaged consumer.

Missing, unreadable, or unsupported assets produce a warning and are omitted.
Startup continues. Check the logs and the login screen after packaging.
Without `branding`, Eden uses its default product name and Electron icon behavior.
Branding is startup configuration; restart the consumer to apply changes.

## Set the installed application identity

Configure the Electron packaging tool's product name and platform icons separately.
Supply ICO for Windows and ICNS for macOS as required by that tool.
Runtime branding does not rename the installed executable or application bundle.

Keep Eden package IDs, settings namespaces, and CSS names unchanged.
They are API identifiers used by apps and integrations.
