/**
 * Style Dictionary Configuration
 *
 * This configuration defines how design tokens are transformed and output.
 * Single source of truth: edencss/tokens.json
 *
 * Tokens hold their dark value in `value` and may hold a light value in
 * `lightValue`, so the active color scheme selects the value.
 */

const GENERATED_NOTICE = [
  "⚠️  AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY",
  "",
  "This file is generated from edencss/tokens.json",
  "Run `npm run tokens:build` to regenerate",
];

function banner(lines) {
  return `/**\n${lines.map((line) => ` *${line ? ` ${line}` : ""}`).join("\n")}\n */\n\n`;
}

const isColor = (token) => token.path[0] === "color";

/** Theme color key: the CSS variable name without its `eden-color-` prefix. */
const themeColorKey = (token) => token.path.slice(1).join("-");

const hasLightValue = (token) => typeof token.original.lightValue === "string";

/** Colors switch with `light-dark()`; other values need a media query. */
function cssValue(token) {
  return isColor(token) && hasLightValue(token)
    ? `light-dark(${token.original.lightValue}, ${token.value})`
    : token.value;
}

function lightOverrides(dictionary) {
  const tokens = dictionary.allTokens.filter(
    (token) => !isColor(token) && hasLightValue(token),
  );
  if (tokens.length === 0) return "";
  return `\n@media (prefers-color-scheme: light) {\n  :root {\n${tokens
    .map((token) => `    --${token.name}: ${token.original.lightValue};`)
    .join("\n")}\n  }\n}\n`;
}

function themeColorTokens(dictionary) {
  return dictionary.allTokens.filter(isColor).map(themeColorKey);
}

export default {
  source: ["tokens.json"],

  hooks: {
    formats: {
      "eden/css-variables": ({ dictionary }) =>
        banner([
          "Eden CSS - Design Tokens",
          "",
          ...GENERATED_NOTICE,
          "",
          "These CSS custom properties define the visual language of Eden.",
          "Colors and shadows follow the active light or dark color scheme.",
        ]) +
        `:root {\n  color-scheme: light dark;\n${dictionary.allTokens
          .map((token) => `  --${token.name}: ${cssValue(token)};`)
          .join("\n")}\n}\n${lightOverrides(dictionary)}`,

      "eden/theme-color-tokens": ({ dictionary }) => {
        const colors = dictionary.allTokens.filter(isColor);
        const defaults = (scheme) =>
          Object.fromEntries(
            colors.map((token) => [
              themeColorKey(token),
              scheme === "light"
                ? (token.original.lightValue ?? token.value)
                : token.value,
            ]),
          );
        return (
          banner(["Theme color tokens", "", ...GENERATED_NOTICE]) +
          `export const THEME_COLOR_TOKENS = ${JSON.stringify(
            themeColorTokens(dictionary),
            null,
            2,
          )} as const;\n\n` +
          "/** Built-in Eden colors of each scheme. */\n" +
          `export const THEME_COLOR_DEFAULTS = ${JSON.stringify(
            { light: defaults("light"), dark: defaults("dark") },
            null,
            2,
          )} as const;\n`
        );
      },

      "eden/theme-color-token-types": ({ dictionary }) =>
        banner(["Theme color tokens", "", ...GENERATED_NOTICE]) +
        `/** Color a theme can set, named like \`--eden-color-<token>\`. */\nexport type EdenThemeColorToken =\n${themeColorTokens(
          dictionary,
        )
          .map((key) => `  | ${JSON.stringify(key)}`)
          .join("\n")};\n`,
    },
  },

  platforms: {
    // Generate CSS custom properties
    css: {
      transformGroup: "css",
      prefix: "eden",
      buildPath: "./",
      files: [{ destination: "tokens.css", format: "eden/css-variables" }],
    },

    // Theme color names for runtime validation and public types
    themes: {
      transformGroup: "js",
      buildPath: "../",
      files: [
        {
          destination: "src/desktop/appearance/theme-color-tokens.ts",
          format: "eden/theme-color-tokens",
        },
        {
          destination: "../types/ThemeColorTokens.d.ts",
          format: "eden/theme-color-token-types",
        },
      ],
    },

    // Generate TypeScript/JavaScript module
    js: {
      transformGroup: "js",
      prefix: "eden",
      buildPath: "./",
      files: [
        {
          destination: "tokens.ts",
          format: "javascript/es6",
          options: {
            outputReferences: false,
            fileHeader: () => [
              "Eden CSS - TypeScript/JavaScript API",
              "",
              "⚠️  AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY",
              "",
              "🎯 SINGLE SOURCE OF TRUTH: src/design-system/tokens.json",
              "",
              "This file is generated from tokens.json using Style Dictionary.",
              "Run `npm run tokens:build` to regenerate",
              "",
              "This provides programmatic access to design tokens for TypeScript/JavaScript code.",
            ],
          },
        },
        {
          destination: "tokens.d.ts",
          format: "typescript/es6-declarations",
          options: {
            outputReferences: false,
          },
        },
      ],
    },
  },
};
