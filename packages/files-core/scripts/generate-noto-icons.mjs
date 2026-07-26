import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getIconData, iconToHTML, iconToSVG } from "@iconify/utils";

const require = createRequire(import.meta.url);
const iconSet = require("@iconify-json/noto/icons.json");
const outputDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/generated/noto",
);

const icons = [
  "artist-palette",
  "clipboard",
  "closed-book",
  "file-folder",
  "framed-picture",
  "globe-with-meridians",
  "memo",
  "open-file-folder",
  "package",
  "page-facing-up",
  "scroll",
];

const writeIfChanged = async (path, content) => {
  try {
    if ((await readFile(path, "utf8")) === content) return false;
  } catch {
    // The file does not exist yet.
  }

  await writeFile(path, content, "utf8");
  return true;
};

await mkdir(outputDirectory, { recursive: true });

const expectedFiles = new Set(icons.map((name) => `${name}.svg`));
for (const file of await readdir(outputDirectory)) {
  if (file.endsWith(".svg") && !expectedFiles.has(file)) {
    await unlink(join(outputDirectory, file));
  }
}

let changed = 0;
for (const name of icons) {
  const icon = getIconData(iconSet, name);
  if (!icon) {
    throw new Error(`Noto icon "${name}" is missing from @iconify-json/noto`);
  }

  const rendered = iconToSVG(icon, { height: "auto" });
  const svg = `${iconToHTML(rendered.body, rendered.attributes)}\n`;
  if (await writeIfChanged(join(outputDirectory, `${name}.svg`), svg)) {
    changed += 1;
  }
}

console.log(
  changed === 0
    ? "Noto file graphics are up to date."
    : `Generated ${changed} Noto file graphic${changed === 1 ? "" : "s"}.`,
);
