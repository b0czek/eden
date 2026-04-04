import * as fs from "node:fs/promises";
import * as path from "node:path";

export type ScaffoldSolidAppMode = "auto" | "sdk" | "consumer";

export interface ScaffoldSolidAppOptions {
  appId: string;
  outputDir?: string;
  name?: string;
  force?: boolean;
  mode?: ScaffoldSolidAppMode;
}

const DEFAULT_TYPESCRIPT_VERSION = "^5.3.0";
const DEFAULT_VITE_VERSION = "^7.2.4";
const DEFAULT_SOLID_VERSION = "^1.9.10";
const DEFAULT_VITE_PLUGIN_SOLID_VERSION = "^2.11.10";
const DEFAULT_EDEN_TYPES_VERSION = "^0.5.2";

interface GeneratedFile {
  relativePath: string;
  content: string;
}

interface ScaffoldContext {
  mode: Exclude<ScaffoldSolidAppMode, "auto">;
  targetDir: string;
  edenTypesVersion: string;
}

export async function scaffoldSolidApp(
  options: ScaffoldSolidAppOptions,
): Promise<string> {
  validateAppId(options.appId);

  const appName = options.name?.trim() || deriveAppName(options.appId);
  const context = await resolveScaffoldContext(options);

  await ensureTargetDirectory(context.targetDir, options.force ?? false);

  const files = createScaffoldFiles(options.appId, appName, context);

  await fs.mkdir(context.targetDir, { recursive: true });

  for (const file of files) {
    const filePath = path.join(context.targetDir, file.relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.content, "utf-8");
  }

  console.log(`✅ Scaffolded Solid renderer app: ${options.appId}`);
  console.log(`   Name: ${appName}`);
  console.log(`   Mode: ${context.mode}`);
  console.log(`   Path: ${context.targetDir}`);

  return context.targetDir;
}

function validateAppId(appId: string): void {
  if (!appId) {
    throw new Error("App ID is required");
  }

  if (!/^[a-z0-9.-]+$/.test(appId)) {
    throw new Error(
      "Invalid app ID. Use lowercase letters, numbers, dots, and hyphens only.",
    );
  }

  const segments = appId.split(".");
  if (segments.some((segment) => !segment || !/^[a-z0-9-]+$/.test(segment))) {
    throw new Error(
      "Invalid app ID. Use dot-separated segments containing lowercase letters, numbers, and hyphens.",
    );
  }
}

async function resolveScaffoldContext(
  options: ScaffoldSolidAppOptions,
): Promise<ScaffoldContext> {
  const workspaceRoot = await findWorkspaceRoot(process.cwd());
  const mode = await resolveMode(options.mode ?? "auto", workspaceRoot);
  const targetDir = await resolveTargetDirectory(
    options.appId,
    options.outputDir,
    mode,
    workspaceRoot,
  );
  const edenTypesVersion =
    mode === "sdk"
      ? "workspace:*"
      : await resolvePublishedPackageVersion("@edenapp/types");

  return {
    mode,
    targetDir,
    edenTypesVersion,
  };
}

async function resolveTargetDirectory(
  appId: string,
  outputDir: string | undefined,
  mode: Exclude<ScaffoldSolidAppMode, "auto">,
  workspaceRoot: string | null,
): Promise<string> {
  if (outputDir) {
    return path.resolve(outputDir);
  }

  if (mode === "sdk" && workspaceRoot) {
    const sdkAppsDir = path.join(workspaceRoot, "packages", "sdk", "apps");
    return path.join(sdkAppsDir, ...appId.split("."));
  }

  return path.resolve("apps", ...appId.split("."));
}

async function findWorkspaceRoot(startDir: string): Promise<string | null> {
  let currentDir = path.resolve(startDir);

  while (true) {
    try {
      await fs.access(path.join(currentDir, "pnpm-workspace.yaml"));
      return currentDir;
    } catch {
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        return null;
      }
      currentDir = parentDir;
    }
  }
}

async function resolveMode(
  requestedMode: ScaffoldSolidAppMode,
  workspaceRoot: string | null,
): Promise<Exclude<ScaffoldSolidAppMode, "auto">> {
  if (
    requestedMode !== "auto" &&
    requestedMode !== "sdk" &&
    requestedMode !== "consumer"
  ) {
    throw new Error(
      `Invalid scaffold mode: ${requestedMode}. Use auto, sdk, or consumer.`,
    );
  }

  if (requestedMode !== "auto") {
    if (requestedMode === "sdk" && !(await isEdenMonorepo(workspaceRoot))) {
      throw new Error(
        "SDK mode requires the Eden workspace layout (packages/sdk/apps, packages/types).",
      );
    }

    return requestedMode;
  }

  return (await isEdenMonorepo(workspaceRoot)) ? "sdk" : "consumer";
}

async function isEdenMonorepo(workspaceRoot: string | null): Promise<boolean> {
  if (!workspaceRoot) {
    return false;
  }

  const requiredPaths = [
    path.join(workspaceRoot, "packages", "sdk", "apps"),
    path.join(workspaceRoot, "packages", "types", "package.json"),
    path.join(workspaceRoot, "packages", "scripts", "package.json"),
  ];

  for (const requiredPath of requiredPaths) {
    try {
      await fs.access(requiredPath);
    } catch {
      return false;
    }
  }

  return true;
}

async function resolvePublishedPackageVersion(
  packageName: string,
): Promise<string> {
  try {
    const packageJsonPath = path.resolve(__dirname, "..", "package.json");
    const content = await fs.readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content) as { version?: string };

    if (packageJson.version) {
      return `^${packageJson.version}`;
    }
  } catch {
    // Fall back to the last known published version if package metadata is unavailable.
  }

  if (packageName === "@edenapp/types") {
    return DEFAULT_EDEN_TYPES_VERSION;
  }

  throw new Error(`Unable to determine version for ${packageName}`);
}

async function ensureTargetDirectory(
  targetDir: string,
  force: boolean,
): Promise<void> {
  try {
    const stats = await fs.stat(targetDir);
    if (!stats.isDirectory()) {
      throw new Error(`Target exists and is not a directory: ${targetDir}`);
    }

    const entries = await fs.readdir(targetDir);
    if (entries.length > 0 && !force) {
      throw new Error(
        `Target directory is not empty: ${targetDir}. Use --force to overwrite scaffold files.`,
      );
    }
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function deriveAppName(appId: string): string {
  const lastSegment = appId.split(".").at(-1) ?? appId;
  return lastSegment
    .split("-")
    .filter(Boolean)
    .map((segment) => segment[0].toUpperCase() + segment.slice(1))
    .join(" ");
}

function createScaffoldFiles(
  appId: string,
  appName: string,
  context: ScaffoldContext,
): GeneratedFile[] {
  const buildCommand =
    context.mode === "sdk" ? "pnpm run build" : "npm run build";

  return [
    {
      relativePath: "manifest.json",
      content: formatJson({
        id: appId,
        name: appName,
        version: "1.0.0",
        description: `${appName} renderer app`,
        build: {
          command: buildCommand,
        },
        frontend: {
          entry: "dist/index.html",
        },
        window: {
          mode: "both",
          defaultSize: {
            width: 640,
            height: 480,
          },
          minSize: {
            width: 320,
            height: 240,
          },
          resizable: true,
          movable: true,
        },
      }),
    },
    {
      relativePath: "package.json",
      content: formatJson({
        name: appId,
        version: "1.0.0",
        private: true,
        type: "module",
        scripts: {
          dev: "vite",
          build: "vite build",
        },
        dependencies: {
          "solid-js": DEFAULT_SOLID_VERSION,
        },
        devDependencies: {
          "@edenapp/types": context.edenTypesVersion,
          typescript: DEFAULT_TYPESCRIPT_VERSION,
          vite: DEFAULT_VITE_VERSION,
          "vite-plugin-solid": DEFAULT_VITE_PLUGIN_SOLID_VERSION,
        },
      }),
    },
    {
      relativePath: "tsconfig.json",
      content: formatJson({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          resolveJsonModule: true,
          allowSyntheticDefaultImports: true,
          esModuleInterop: true,
          forceConsistentCasingInFileNames: true,
          strict: true,
          skipLibCheck: true,
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          types: ["vite/client", "@edenapp/types/global"],
          useDefineForClassFields: true,
          isolatedModules: true,
          noEmit: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noFallthroughCasesInSwitch: true,
          jsx: "preserve",
          jsxImportSource: "solid-js",
        },
        include: ["src"],
      }),
    },
    {
      relativePath: "vite.config.mts",
      content: [
        'import { dirname, resolve } from "node:path";',
        'import { fileURLToPath } from "node:url";',
        'import { defineConfig } from "vite";',
        'import solidPlugin from "vite-plugin-solid";',
        "",
        "const __filename = fileURLToPath(import.meta.url);",
        "const __dirname = dirname(__filename);",
        "",
        "export default defineConfig({",
        "  plugins: [solidPlugin()],",
        '  base: "./",',
        "  root: __dirname,",
        "  build: {",
        '    outDir: "./dist",',
        "    emptyOutDir: true,",
        "    rollupOptions: {",
        '      input: resolve(__dirname, "index.html"),',
        "    },",
        "  },",
        "  resolve: {",
        '    conditions: ["development", "browser"],',
        "  },",
        "});",
        "",
      ].join("\n"),
    },
    {
      relativePath: "index.html",
      content: [
        "<!DOCTYPE html>",
        '<html lang="en">',
        "  <head>",
        '    <meta charset="UTF-8" />',
        '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        `    <title>${escapeHtml(appName)}</title>`,
        "  </head>",
        "  <body>",
        '    <div id="root"></div>',
        '    <script type="module" src="/src/index.tsx"></script>',
        "  </body>",
        "</html>",
        "",
      ].join("\n"),
    },
    {
      relativePath: "src/index.tsx",
      content: [
        "/* @refresh reload */",
        'import { render } from "solid-js/web";',
        'import App from "./App";',
        "",
        'const root = document.getElementById("root");',
        "",
        "if (root) {",
        "  render(() => <App />, root);",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "src/App.tsx",
      content: [
        'import type { Component } from "solid-js";',
        "",
        `const APP_NAME = ${JSON.stringify(appName)};`,
        "",
        "const App: Component = () => {",
        "  return (",
        '    <main class="eden-p-lg">',
        '      <span class="eden-text-sm eden-text-secondary">{APP_NAME}</span>',
        "    </main>",
        "  );",
        "};",
        "",
        "export default App;",
        "",
      ].join("\n"),
    },
  ];
}

function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
