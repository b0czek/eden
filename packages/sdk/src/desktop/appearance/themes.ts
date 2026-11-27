import type {
  ColorScheme,
  EdenAppearanceConfig,
  EdenTheme,
} from "@edenapp/types";
import * as v from "valibot";
import { InvalidAppearanceConfig } from "./errors";
import { THEME_COLOR_DEFAULTS, THEME_COLOR_TOKENS } from "./theme-color-tokens";

const colorSchemeSchema = v.picklist(["light", "dark"] as const);

/** Built-in themes use the token defaults, so they set no colors. */
export const BUILTIN_THEMES: Record<ColorScheme, EdenTheme> = {
  dark: {
    id: "eden-dark",
    name: { en: "Eden Dark", pl: "Eden ciemny" },
    colorScheme: "dark",
    colors: {},
  },
  light: {
    id: "eden-light",
    name: { en: "Eden Light", pl: "Eden jasny" },
    colorScheme: "light",
    colors: {},
  },
};

// A value is inserted into a stylesheet, so it must not end its declaration
// or start a comment.
const cssColorSchema = v.pipe(
  v.string(),
  v.trim(),
  v.nonEmpty(),
  v.regex(/^[^;{}<>\\\n\r]+$/, "must be a single CSS value"),
  v.check((value) => !value.includes("/*"), "must not contain a comment"),
);

const themeSchema = v.object({
  id: v.pipe(v.string(), v.trim(), v.nonEmpty()),
  name: v.union([
    v.pipe(v.string(), v.nonEmpty()),
    v.record(v.string(), v.string()),
  ]),
  colorScheme: colorSchemeSchema,
  colors: v.strictObject(
    Object.fromEntries(
      THEME_COLOR_TOKENS.map((token) => [token, v.optional(cssColorSchema)]),
    ),
  ),
});

const appearanceConfigSchema = v.object({
  themes: v.optional(v.array(themeSchema)),
  defaultTheme: v.optional(v.string()),
});

export interface ThemeCatalog {
  themes: readonly EdenTheme[];
  defaultTheme: EdenTheme;
  find(id: string): EdenTheme | undefined;
}

/** Fails with InvalidAppearanceConfig when consumer themes are unusable. */
export function createThemeCatalog(
  config: EdenAppearanceConfig | undefined,
): ThemeCatalog {
  const parsed = v.safeParse(appearanceConfigSchema, config ?? {});
  if (!parsed.success) {
    throw new InvalidAppearanceConfig({
      reason: v.summarize(parsed.issues),
    });
  }
  const options = parsed.output;
  const themes: EdenTheme[] = [BUILTIN_THEMES.dark, BUILTIN_THEMES.light];
  for (const theme of (options.themes ?? []) as EdenTheme[]) {
    if (themes.some((existing) => existing.id === theme.id)) {
      throw new InvalidAppearanceConfig({
        reason: `theme ID "${theme.id}" is used more than once`,
      });
    }
    themes.push(theme);
  }

  function find(id: string) {
    return themes.find((theme) => theme.id === id);
  }

  const defaultTheme =
    options.defaultTheme === undefined
      ? BUILTIN_THEMES.dark
      : find(options.defaultTheme);
  if (!defaultTheme) {
    throw new InvalidAppearanceConfig({
      reason: `default theme "${options.defaultTheme}" is not configured`,
    });
  }

  return { themes, defaultTheme, find };
}

/**
 * CSS that applies a theme's colors over Eden CSS. It is limited to the
 * theme's scheme so it never colors the other scheme while switching.
 */
export function themeStylesheet(theme: EdenTheme) {
  const declarations = Object.entries(theme.colors).map(
    ([token, value]) => `  --eden-color-${token}: ${value};`,
  );
  if (declarations.length === 0) return "";
  return `@media (prefers-color-scheme: ${theme.colorScheme}) {\n:root {\n${declarations.join("\n")}\n}\n}`;
}

/** The theme with the colors it inherits from its scheme's defaults. */
export function resolveTheme(theme: EdenTheme): EdenTheme {
  return {
    ...theme,
    colors: { ...THEME_COLOR_DEFAULTS[theme.colorScheme], ...theme.colors },
  };
}

/**
 * The window color shown before the page paints. Electron accepts only
 * hex, rgb() and named colors, so other values use the scheme default.
 */
export function themeBackgroundColor(theme: EdenTheme) {
  const color = theme.colors["bg-primary"];
  return color && /^(#[0-9a-f]{3,8}|rgba?\([^()]*\)|[a-z]+)$/i.test(color)
    ? color
    : THEME_COLOR_DEFAULTS[theme.colorScheme]["bg-primary"];
}
