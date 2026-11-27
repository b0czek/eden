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

const COLOR_FUNCTIONS = new Set([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color",
  "color-mix",
  "light-dark",
  "var",
]);
const CSS_WIDE_KEYWORDS = new Set([
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
]);

/**
 * A value is inserted into a stylesheet, so it must be one CSS color: a hex
 * color, a color keyword, or one call to a color function. It must not end
 * its declaration, open a string or comment, load a resource, or change the
 * declaration's priority.
 */
function isCssColor(value: string) {
  if (/[;{}<>[\]\\"'\n\r!]|\/\*|url\(/i.test(value)) return false;
  if (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) return true;
  if (/^[a-z]+$/i.test(value)) {
    return !CSS_WIDE_KEYWORDS.has(value.toLowerCase());
  }
  const call = /^([a-z-]+)\(/i.exec(value);
  if (!call || !COLOR_FUNCTIONS.has(call[1].toLowerCase())) return false;
  // The function's own parenthesis must close at the end of the value.
  let depth = 0;
  for (let index = call[0].length - 1; index < value.length; index++) {
    if (value[index] === "(") depth++;
    else if (value[index] === ")" && --depth === 0) {
      return index === value.length - 1;
    }
  }
  return false;
}

const cssColorSchema = v.pipe(
  v.string(),
  v.trim(),
  v.nonEmpty(),
  v.check(isCssColor, "must be a single CSS color"),
);

const nameSchema = v.union([
  v.pipe(v.string(), v.trim(), v.nonEmpty()),
  v.pipe(
    v.record(v.string(), v.pipe(v.string(), v.trim(), v.nonEmpty())),
    v.check((names) => Object.keys(names).length > 0, "must not be empty"),
  ),
]);

const themeSchema = v.object({
  id: v.pipe(v.string(), v.trim(), v.nonEmpty()),
  name: nameSchema,
  colorScheme: colorSchemeSchema,
  colors: v.pipe(
    v.strictObject(
      Object.fromEntries(
        THEME_COLOR_TOKENS.map((token) => [token, v.optional(cssColorSchema)]),
      ),
    ),
    // A key set to undefined uses the inherited color.
    v.transform((colors) =>
      Object.fromEntries(
        Object.entries(colors).filter(([, value]) => value !== undefined),
      ),
    ),
  ),
});

const appearanceConfigSchema = v.object({
  themes: v.optional(v.array(themeSchema)),
  defaultTheme: v.optional(v.pipe(v.string(), v.trim())),
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

const NUMBER = String.raw`\s*\d+(?:\.\d+)?%?\s*`;
// Forms that Electron and CSS read the same way. Electron reads 4- and
// 8-digit hex as ARGB, so those use the scheme default.
const WINDOW_COLOR = new RegExp(
  String.raw`^(?:#(?:[0-9a-f]{3}|[0-9a-f]{6})|(?:rgb|hsl)a?\(${NUMBER}(?:,${NUMBER}){2,3}\))$`,
  "i",
);

/**
 * The window color shown where no page is painted. Values Electron cannot
 * read use the scheme default.
 */
export function themeBackgroundColor(theme: EdenTheme) {
  const color = theme.colors["bg-primary"];
  return color && WINDOW_COLOR.test(color)
    ? color
    : THEME_COLOR_DEFAULTS[theme.colorScheme]["bg-primary"];
}
