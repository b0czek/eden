const fs = require("node:fs");
const path = require("node:path");

const sdkRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(sdkRoot, "src");
const allowedElectronImporters = [
  path.join(sourceRoot, "Eden.ts"),
  `${path.join(sourceRoot, "platform", "electron")}${path.sep}`,
  // Preloads are renderer/utility-process production adapters.
  `${path.join(sourceRoot, "app-runtime")}${path.sep}`,
];

const electronImport =
  /(?:from\s+["']electron["']|require\(\s*["']electron["']\s*\))/;
const productionAdapterImport =
  /from\s+["'][^"']*platform\/electron(?:\/[^"']*)?["']/;

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
      return [];
    }
    return [entryPath];
  });
}

function canImportElectron(filePath) {
  return allowedElectronImporters.some((allowedPath) =>
    allowedPath.endsWith(path.sep)
      ? filePath.startsWith(allowedPath)
      : filePath === allowedPath,
  );
}

const violations = [];
for (const filePath of sourceFiles(sourceRoot)) {
  const source = fs.readFileSync(filePath, "utf8");
  const relativePath = path.relative(sdkRoot, filePath);

  if (electronImport.test(source) && !canImportElectron(filePath)) {
    violations.push(`${relativePath}: direct Electron import`);
  }
  if (
    productionAdapterImport.test(source) &&
    filePath !== path.join(sourceRoot, "Eden.ts") &&
    !filePath.startsWith(
      `${path.join(sourceRoot, "platform", "electron")}${path.sep}`,
    )
  ) {
    violations.push(
      `${relativePath}: production adapter imported by runtime code`,
    );
  }
}

if (violations.length > 0) {
  console.error("Eden SDK architecture boundary violations:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log("Eden SDK architecture boundaries are valid.");
}
