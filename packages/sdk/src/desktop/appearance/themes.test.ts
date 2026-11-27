import type { EdenTheme } from "@edenapp/types";
import {
  createThemeCatalog,
  resolveTheme,
  themeBackgroundColor,
  themeStylesheet,
} from "./themes";

const theme = (colors: EdenTheme["colors"]): EdenTheme => ({
  id: "acme",
  name: "Acme",
  colorScheme: "light",
  colors,
});

it("uses the inherited color for a color set to undefined", () => {
  const catalog = createThemeCatalog({
    themes: [theme({ "accent-primary": undefined, success: "#00aa00" })],
  });
  const acme = catalog.find("acme");
  if (!acme) throw new Error("missing theme");

  expect(acme.colors).toEqual({ success: "#00aa00" });
  expect(themeStylesheet(acme)).not.toContain("undefined");
  expect(resolveTheme(acme).colors["accent-primary"]).toBe("#1f7ae0");
});

it.each([
  "RebeccaPurple",
  "transparent",
  "#abcd",
  "oklch(70% 0.1 200)",
  "rgb(0 0 0 / 50%)",
  "color-mix(in srgb, var(--eden-color-accent-primary) 20%, transparent)",
  "light-dark(#ffffff, #000000)",
])("accepts the color %s", (color) => {
  const catalog = createThemeCatalog({
    themes: [theme({ "accent-primary": color })],
  });
  expect(catalog.find("acme")?.colors["accent-primary"]).toBe(color);
});

it("matches the default theme ID after trimming", () => {
  const catalog = createThemeCatalog({
    themes: [theme({})],
    defaultTheme: " acme ",
  });
  expect(catalog.defaultTheme.id).toBe("acme");
});

it.each([
  ["#abc", "#abc"],
  ["#aabbcc", "#aabbcc"],
  ["rgb(1, 2, 3)", "rgb(1, 2, 3)"],
  ["hsla(120, 50%, 50%, 0.5)", "hsla(120, 50%, 50%, 0.5)"],
  // Electron reads 8-digit hex as ARGB.
  ["#aabbccdd", "#f5f5f7"],
  ["#12345", "#f5f5f7"],
  ["inherit", "#f5f5f7"],
  ["rgb(0 0 0 / 50%)", "#f5f5f7"],
])("gives the window the background %s as %s", (color, expected) => {
  expect(themeBackgroundColor(theme({ "bg-primary": color }))).toBe(expected);
});
