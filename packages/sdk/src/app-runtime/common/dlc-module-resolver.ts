import * as fs from "node:fs";
import { registerHooks } from "node:module";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface BackendDlcBinding {
  capability: string;
  roots: Record<string, string>;
}

const SCHEME = "eden-dlc:";
const AUTHORITY = "resource";

function dlcSpecifier(
  specifier: string,
  parentURL?: string,
): string | undefined {
  if (specifier.startsWith(SCHEME)) return specifier;
  if (!parentURL?.startsWith(SCHEME)) return undefined;
  if (
    !specifier.startsWith("./") &&
    !specifier.startsWith("../") &&
    !specifier.startsWith("/")
  ) {
    return undefined;
  }
  return new URL(specifier, parentURL).href;
}

export function resolveDlcModuleSpecifier(
  specifier: string,
  binding: BackendDlcBinding,
): string | undefined {
  if (!specifier.startsWith(SCHEME)) return undefined;

  const url = new URL(specifier);
  if (url.protocol !== SCHEME || url.hostname !== AUTHORITY) {
    throw new Error("Invalid Eden DLC module URL");
  }
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  if (
    segments.length < 3 ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("/") ||
        segment.includes("\\") ||
        segment.includes("\0"),
    )
  ) {
    throw new Error("Invalid Eden DLC module path");
  }
  const [capability, dlcId, ...relativeSegments] = segments;
  if (capability !== binding.capability) {
    throw new Error("Invalid Eden DLC module capability");
  }
  const root = binding.roots[dlcId];
  if (!root) throw new Error(`DLC ${dlcId} is not available to this backend`);

  const target = path.resolve(root, ...relativeSegments);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Eden DLC module path escapes its package root");
  }
  const realRoot = fs.realpathSync(root);
  const realTarget = fs.realpathSync(target);
  if (!fs.statSync(realTarget).isFile()) {
    throw new Error("Eden DLC module path is not a file");
  }
  const realRelative = path.relative(realRoot, realTarget);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error("Eden DLC module resolves outside its package root");
  }

  const fileUrl = pathToFileURL(realTarget);
  fileUrl.search = url.search;
  fileUrl.hash = url.hash;
  return fileUrl.href;
}

export function installDlcModuleResolver(serializedBinding?: string): void {
  if (!serializedBinding) return;
  const binding = JSON.parse(serializedBinding) as BackendDlcBinding;
  const nativeFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (input, init) => {
    const requestUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (!requestUrl.startsWith(SCHEME)) return nativeFetch(input, init);

    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      throw new TypeError("Eden DLC resources only support GET and HEAD");
    }
    const signal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);
    signal?.throwIfAborted();
    const fileUrl = resolveDlcModuleSpecifier(requestUrl, binding);
    if (!fileUrl) throw new TypeError("Invalid Eden DLC resource URL");
    const filePath = fileURLToPath(fileUrl);
    const body = method === "HEAD" ? null : fs.readFileSync(filePath);
    signal?.throwIfAborted();
    const response = new Response(body, {
      status: 200,
      headers: {
        "Content-Type": mimeType(filePath),
        "X-Content-Type-Options": "nosniff",
      },
    });
    Object.defineProperty(response, "url", { value: requestUrl });
    return response;
  };

  registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = dlcSpecifier(specifier, context.parentURL);
      if (!resolved) return nextResolve(specifier, context);
      resolveDlcModuleSpecifier(resolved, binding);
      return { url: resolved, shortCircuit: true };
    },
    load(url, context, nextLoad) {
      const translated = resolveDlcModuleSpecifier(url, binding);
      if (!translated) return nextLoad(url, context);
      return { ...nextLoad(translated, context), shortCircuit: true };
    },
  });
}

function mimeType(filePath: string): string {
  const types: Record<string, string> = {
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".cjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".wasm": "application/wasm",
    ".css": "text/css; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
  };
  return (
    types[path.extname(filePath).toLowerCase()] ?? "application/octet-stream"
  );
}
