# Localizing Eden Apps

Guide for adding typed i18n to Eden apps.

## Setup Steps

### 1. Create Locale Files

**`src/locales/en.ts`**

```typescript
export const en = {
  myApp: {
    welcome: "Welcome",
    greeting: "Hello, {name}",
  },
} as const;
```

**`src/locales/pl.ts`**

```typescript
export const pl = {
  myApp: {
    welcome: "Witamy",
    greeting: "Witaj, {name}",
  },
} as const;
```

**Critical**: Must use `as const` for type inference.

### 2. Setup i18n

**`src/i18n.ts`**

```typescript
import { setupI18n } from "@edenapp/babel/solid";
import type { I18nCommonTranslations } from "@edenapp/babel/generated/i18n";
import type { InferTranslations } from "@edenapp/babel/types";
import { en } from "./locales/en";
import { pl } from "./locales/pl";

type AppTranslations = InferTranslations<typeof en>;
type AllTranslations = I18nCommonTranslations & AppTranslations;

const resources = {
  en: { translation: en },
  pl: { translation: pl },
};

export const { t, locale, setLocale, initLocale } = setupI18n<AllTranslations>({
  resources,
});
```

### 3. Add Dependency

Run `pnpm i @edenapp/babel`.

### 4. Initialize

**`App.tsx`**

```tsx
import { onMount } from "solid-js";
import { t, initLocale } from "./i18n";

function App() {
  onMount(() => initLocale());
  return <h1>{t("myApp.welcome")}</h1>;
}
```

### 5. Use in Components

```tsx
import { t } from "../i18n";

export function MyComponent() {
  return <button>{t("common.save")}</button>;
}
```

## Common SDK Translations

Common `common.*` keys include: `ok`, `cancel`, `save`, `delete`, `close`, `deleteConfirmation`, etc.

See [`packages/sdk/src/i18n/locales/en.ts`](../packages/sdk/src/i18n/locales/en.ts) for the full list.

## Interpolation

```typescript
// Locale
export const en = {
  myApp: {
    greeting: "Hello, {name}!",
  },
} as const;

// Usage
t("myApp.greeting", { name: "Alice" });
```

## Reactive Locale

```tsx
import { locale } from "./i18n";

const getLocalizedName = (name: string | Record<string, string>) => {
  if (typeof name === "string") return name;
  return name[locale()] || name.en || Object.values(name)[0];
};
```

## Localized Manifest

```json
{
  "id": "com.example.myapp",
  "name": {
    "en": "My App",
    "pl": "Moja Aplikacja"
  }
}
```

## Key Rules

1. **Always use `as const`** on locale exports
2. **Namespace keys** - Use app name as top-level key
3. **Use common keys** - Prefer `common.*` over duplicates
4. **Call `initLocale()`** - Required in `onMount()`

## Reference

See: `packages/sdk/apps/com/eden/editor`, `packages/sdk/apps/com/eden/eveshell`
