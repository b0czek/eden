import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { DlcResource } from "@edenapp/types";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import { fromPromise } from "../effects/io";
import { listen } from "../events/scoped";
import type {
  PlatformProtocolRequest,
  PlatformProtocolResponse,
} from "../platform/ports";
import type { Views } from "../views/service";
import type { PackageCatalog } from "./catalog";

const SCHEME = "eden-dlc";
const AUTHORITY = "resource";

interface Capability {
  appId: string;
  webContentsId: number;
}

export interface BackendDlcBinding {
  capability: string;
  roots: Record<string, string>;
}

export interface DlcResourceProtocols {
  serve(
    scheme: string,
    authorize: (request: PlatformProtocolRequest) => boolean,
    handler: (
      request: PlatformProtocolRequest,
    ) => Effect.Effect<PlatformProtocolResponse, Error>,
  ): Effect.Effect<void, Error, Scope.Scope>;
}
export const createDlcResources = Effect.fn(function* ({
  catalog,
  views,
  protocols,
}: {
  catalog: PackageCatalog;
  views: Pick<Views, "viewRemoved">;
  protocols: DlcResourceProtocols;
}) {
  const capabilities = new Map<string, Capability>();
  const capabilityByView = new Map<number, Map<string, string>>();
  const backendBindings = new Map<string, BackendDlcBinding>();
  function list(hostAppId: string, webContentsId?: number): DlcResource[] {
    const manifests = catalog.dlcsForHost(hostAppId);
    if (webContentsId === undefined) {
      const binding =
        backendBindings.get(hostAppId) ?? createBackendBinding(hostAppId);
      return manifests.map((manifest) => ({
        manifest,
        rootUrl: rootUrl(binding.capability, manifest.id),
      }));
    }

    const capability = getOrCreateCapability(hostAppId, webContentsId);
    return manifests.map((manifest) => ({
      manifest,
      rootUrl: rootUrl(capability, manifest.id),
    }));
  }

  function createBackendBinding(appId: string): BackendDlcBinding {
    const roots = Object.fromEntries(
      catalog.dlcsForHost(appId).map((manifest) => {
        const root = catalog.getPath(manifest.id);
        if (!root) throw new Error(`DLC ${manifest.id} is not installed`);
        return [manifest.id, root];
      }),
    );
    const binding = {
      capability: randomBytes(32).toString("base64url"),
      roots,
    };
    backendBindings.set(appId, binding);
    return structuredClone(binding);
  }

  function revokeBackend(appId: string): void {
    backendBindings.delete(appId);
  }

  function getOrCreateCapability(appId: string, webContentsId: number): string {
    let capabilityByHost = capabilityByView.get(webContentsId);
    if (!capabilityByHost) {
      capabilityByHost = new Map();
      capabilityByView.set(webContentsId, capabilityByHost);
    }
    const existing = capabilityByHost.get(appId);
    if (existing) return existing;

    const capability = randomBytes(32).toString("base64url");
    capabilities.set(capability, { appId, webContentsId });
    capabilityByHost.set(appId, capability);
    return capability;
  }

  function revokeView(webContentsId: number): void {
    const capabilityByHost = capabilityByView.get(webContentsId);
    if (!capabilityByHost) return;
    for (const capability of capabilityByHost.values()) {
      capabilities.delete(capability);
    }
    capabilityByView.delete(webContentsId);
  }

  function authorize(request: PlatformProtocolRequest): boolean {
    if (request.method !== "GET" && request.method !== "HEAD") return false;
    if (request.webContentsId === undefined) return false;
    const route = parseRoute(request.url);
    if (!route) return false;
    const binding = capabilities.get(route.capability);
    if (!binding || binding.webContentsId !== request.webContentsId) {
      return false;
    }
    const manifest = catalog.getDlc(route.dlcId);
    return manifest?.hostAppId === binding.appId;
  }

  const serve = Effect.fn(function* (request: PlatformProtocolRequest) {
    const route = parseRoute(request.url);
    if (!route?.relativePath) return { status: 404 };
    return yield* Effect.gen(function* () {
      const filePath = yield* catalog.resolveContainedDlcPath(
        route.dlcId,
        route.relativePath,
      );
      const stat = yield* fromPromise(() => fs.stat(filePath));
      if (!stat.isFile()) return { status: 404 };
      return {
        status: 200,
        filePath,
        headers: {
          "Content-Type": mimeType(filePath),
          "X-Content-Type-Options": "nosniff",
          "Cross-Origin-Resource-Policy": "cross-origin",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "private, max-age=31536000, immutable",
        },
      };
    }).pipe(Effect.catch(() => Effect.succeed({ status: 404 })));
  });

  function parseRoute(urlValue: string): {
    capability: string;
    dlcId: string;
    relativePath: string;
  } | null {
    try {
      const url = new URL(urlValue);
      if (url.protocol !== `${SCHEME}:` || url.hostname !== AUTHORITY) {
        return null;
      }
      const rawSegments = url.pathname.split("/").filter(Boolean);
      if (rawSegments.length < 2) return null;
      const decoded = rawSegments.map((segment) => decodeURIComponent(segment));
      if (
        decoded.some(
          (segment) =>
            !segment ||
            segment === "." ||
            segment === ".." ||
            segment.includes("/") ||
            segment.includes("\\") ||
            segment.includes("\0"),
        )
      ) {
        return null;
      }
      return {
        capability: decoded[0],
        dlcId: decoded[1],
        relativePath: decoded.slice(2).join(path.sep),
      };
    } catch {
      return null;
    }
  }

  function rootUrl(capability: string, dlcId: string): string {
    return `${SCHEME}://${AUTHORITY}/${capability}/${encodeURIComponent(dlcId)}/`;
  }

  function mimeType(filePath: string): string {
    const types: Record<string, string> = {
      ".js": "text/javascript; charset=utf-8",
      ".mjs": "text/javascript; charset=utf-8",
      ".cjs": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".wasm": "application/wasm",
      ".map": "application/json; charset=utf-8",
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
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      capabilities.clear();
      capabilityByView.clear();
      backendBindings.clear();
    }),
  );
  yield* protocols.serve(SCHEME, authorize, serve);
  yield* listen(views.viewRemoved, ({ webContentsId }) =>
    revokeView(webContentsId),
  );
  return { list, createBackendBinding, revokeBackend };
});
export type DlcResources = Effect.Success<
  ReturnType<typeof createDlcResources>
>;
