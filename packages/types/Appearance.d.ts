import type { EdenThemeColorToken } from "./ThemeColorTokens";

export type { EdenThemeColorToken } from "./ThemeColorTokens";

/** Light or dark appearance used by Eden and its apps. */
export type ColorScheme = "light" | "dark";

/**
 * A named set of Eden colors. Its color scheme decides whether Eden and its
 * apps appear light or dark while it is selected.
 *
 * Colors left out use the built-in Eden theme of the same scheme.
 */
export interface EdenTheme {
  /** Stable ID saved with the user's selection. */
  id: string;
  /** Display name, either text or a map from locale to text. */
  name: string | Record<string, string>;
  /** Whether the theme is light or dark. */
  colorScheme: ColorScheme;
  /** CSS colors keyed by token, so `"accent-primary"` sets `--eden-color-accent-primary`. */
  colors: Partial<Record<EdenThemeColorToken, string>>;
}

/** Themes offered by the consumer in addition to the built-in Eden themes. */
export interface EdenAppearanceConfig {
  themes?: EdenTheme[];
  /** Theme used until the user chooses one. Defaults to `"eden-dark"`. */
  defaultTheme?: string;
}

/** Current appearance selection. */
export interface AppearanceState {
  /** The selected theme, with every color including those it inherits. */
  theme: EdenTheme;
  /** Scheme of the selected theme. */
  colorScheme: ColorScheme;
}
