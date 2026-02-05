/**
 * Style Dictionary Configuration
 *
 * This configuration defines how design tokens are transformed and output.
 * Single source of truth: src/design-system/tokens.json
 */

export default {
  source: ["tokens.json"],

  platforms: {
    // Generate CSS custom properties
    css: {
      transformGroup: "css",
      prefix: "eden",
      buildPath: "./",
      files: [
        {
          destination: "tokens.css",
          format: "css/variables",
          options: {
            selector: ":root",
            outputReferences: true,
            fileHeader: () => [
              "Eden CSS - Design Tokens",
              "",
              "⚠️  AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY",
              "",
              "This file is generated from src/edencss/tokens.json",
              "Run `npm run tokens:build` to regenerate",
              "",
              "These CSS custom properties define the visual language of Eden.",
              "They can be used in any app or component.",
            ],
          },
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
