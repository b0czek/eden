# Branding an Eden Consumer

SDK consumers can replace Eden's user-facing product identity through the
runtime configuration passed to `new Eden(...)`:

```ts
import { Eden } from "@edenapp/sdk";

new Eden({
  branding: {
    name: "Acme Workspace",
    logoPath: "assets/acme-logo.svg",
    iconPath: "assets/acme-icon.png",
  },
});
```

`name` is required when `branding` is present. It is shown in SDK-owned
interfaces such as Settings and is used as the main window title unless
`window.title` is explicitly configured.

`logoPath` is optional and supplies the logo shown on the login screen.
Supported formats are SVG, PNG, JPEG, and WebP.

`iconPath` is optional and supplies the native main-window icon. PNG and ICO
files are supported. Electron recommends ICO for the best Windows results.

Relative asset paths resolve from Electron's application directory
(`app.getAppPath()`). Absolute paths are also accepted, primarily for
development. Branding assets must be included in the consumer's packaged
application.

Missing, unreadable, or unsupported assets produce a warning and are omitted;
they do not prevent startup. Omitting `branding` preserves the default Eden
name and Electron icon behavior.

## Packaging Identity

Runtime branding does not rename an installed executable or macOS application
bundle. Configure the consumer's Electron packaging tool separately:

- Set its product/application name (commonly `productName`).
- Supply the required platform icons, including ICO on Windows and ICNS on
  macOS.

Internal identifiers such as `com.eden.*`, `@edenapp/*`, EdenCSS names, and
settings namespaces remain stable. Branding is startup configuration and
cannot be edited from Settings or changed while Eden is running.
