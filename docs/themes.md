# Add themes

[Handbook](README.md) · Prerequisite: [Create a consumer](consumer-development.md)

A theme is a named set of Eden colors that is either light or dark.
Users choose a theme in **Settings → Appearance**.
The theme's scheme decides whether Eden, its apps, and native controls appear light or dark.
Each wallpaper preset shows a light or dark variant to match.
A variant can have its own name: **Pure Black** becomes **Pure White** in a light theme.

Eden includes **Eden Dark** (`eden-dark`) and **Eden Light** (`eden-light`).
Add your own themes in the consumer's runtime configuration:

```ts
import { createEden } from "@edenapp/sdk";

const eden = createEden({
  appearance: {
    themes: [
      {
        id: "acme-light",
        name: { en: "Acme Light", pl: "Acme jasny" },
        colorScheme: "light",
        colors: {
          "accent-primary": "#ff6600",
          "accent-primary-hover": "#ff7a1f",
          "accent-primary-active": "#e65c00",
        },
      },
    ],
    defaultTheme: "acme-light",
  },
});
```

| Field | Use |
| --- | --- |
| `id` | Stable ID saved with the user's choice |
| `name` | Text, or a map from locale to text |
| `colorScheme` | `"light"` or `"dark"` |
| `colors` | CSS colors by token name |
| `defaultTheme` | Theme used until the user chooses one; defaults to `eden-dark` |

A color key is an EdenCSS color variable without its prefix:
`"accent-primary"` sets `--eden-color-accent-primary`.
The `EdenThemeColorToken` type lists the keys, and
[tokens.css](../packages/sdk/edencss/tokens.css) shows the default values.
Colors you leave out use the built-in theme of the same scheme,
so a theme can change only its accent.

Eden refuses to start when a theme repeats an ID, uses an unknown key,
or has a value that is not a single CSS value,
or when `defaultTheme` names a theme that is not configured.
If a saved theme is no longer configured, Eden uses `defaultTheme`.
Themes are startup configuration; restart the consumer to apply changes.

## Change the theme from the host

```ts
await eden.whenReady();
const { theme, colorScheme } = eden.appearance.getState();
await eden.runPromise(eden.appearance.setTheme("eden-light"));
eden.appearance.onAppearanceChanged(({ theme }) => console.log(theme.id));
```

`getThemes()` lists the built-in and configured themes.
Each theme includes the colors it inherits, so you can show a preview of it.
Apps can read the selection with `appearance/get-appearance`,
list the themes with `appearance/get-themes`, and
subscribe to `appearance/appearance-changed`.

## Support themes in an app

Apps that use EdenCSS follow the theme without changes.
Style with `--eden-color-*` variables instead of fixed colors.
For values that are not colors, use `@media (prefers-color-scheme: light)`.
Apps that set `injections.css` to `"none"` receive no theme colors,
but still see the theme's scheme through `prefers-color-scheme`.
