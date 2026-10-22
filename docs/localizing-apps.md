# Translate an app

[Handbook](README.md) · Prerequisite: [Create an app](app-development.md)

`@edenapp/babel` provides typed translation keys and shared Eden labels.
Its Solid integration updates the UI when the system locale changes.

## Install the translation helper

```bash
npm install @edenapp/babel
```

## Define locale files

Create `src/locales/en.ts`:

```ts
export const en = {
  notes: {
    welcome: "Welcome",
    greeting: "Hello, {name}",
  },
} as const;
```

Create `src/locales/pl.ts` with the same keys:

```ts
export const pl = {
  notes: {
    welcome: "Witamy",
    greeting: "Witaj, {name}",
  },
} as const;
```

Use `as const` so TypeScript can infer keys and interpolation parameters.
Keep app-specific keys under one namespace, such as `notes`.

## Set up typed translations

Create `src/i18n.ts`:

```ts
import { setupI18n } from "@edenapp/babel/solid";
import type { I18nCommonTranslations } from "@edenapp/babel/generated/i18n";
import type { InferTranslations } from "@edenapp/babel/types";
import { en } from "./locales/en";
import { pl } from "./locales/pl";

type Translations = I18nCommonTranslations & InferTranslations<typeof en>;

export const { t, locale, initLocale } = setupI18n<Translations>({
  resources: {
    en: { translation: en },
    pl: { translation: pl },
  },
});
```

## Initialize in the app root

Call `initLocale()` from the root component's `onMount` callback:

```tsx
import { onMount } from "solid-js";
import { initLocale, t } from "./i18n";

export default function App() {
  onMount(() => { void initLocale(); });
  return (
    <main>
      <h1>{t("notes.welcome")}</h1>
      <p>{t("notes.greeting", { name: "Alice" })}</p>
      <button>{t("common.save")}</button>
    </main>
  );
}
```

The helper reads the current locale and subscribes to system changes.
Initialize it once for the app root.
Keep `t()` calls inside reactive JSX expressions so translated text updates.

## Reuse common labels

Use `common.save`, `common.cancel`, `common.close`, and other shared keys for standard actions.
The [English common resource](../packages/sdk/src/i18n/locales/en.ts) lists available labels.
Use app keys for text specific to your app.

## Translate manifest names

Manifest names and setting labels accept locale maps:

```json
{
  "name": { "en": "Notes", "pl": "Notatki" }
}
```

For app-owned locale maps, read the reactive locale when resolving a value:

```ts
import { locale } from "./i18n";

export function localizedName(name: string | Record<string, string>) {
  if (typeof name === "string") return name;
  return name[locale()] ?? name.en ?? Object.values(name)[0] ?? "";
}
```

## Check the translation

Open the app, change the system language in Settings, and confirm that visible labels update.
Check interpolation with a real value and verify that both locale files contain the same keys.
See [Editor](../packages/sdk/apps/com/eden/editor) for a complete localized app.
