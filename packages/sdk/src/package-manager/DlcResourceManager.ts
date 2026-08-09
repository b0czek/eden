import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { DlcResource } from "@edenapp/types";
import { inject, injectable, Lifecycle, scoped } from "tsyringe";
import {
  PLATFORM_RESOURCES,
  type PlatformProtocolRequest,
  type ResourceProtocolPort,
} from "../platform/ports";
import { ViewManager } from "../view-manager/ViewManager";
import { PackageCatalog } from "./PackageCatalog";

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

@scoped(Lifecycle.ContainerScoped)
@injectable()
export class DlcResourceManager {
  private readonly capabilities = new Map<string, Capability>();
  private readonly capabilityByView = new Map<number, string>();
  private readonly backendBindings = new Map<string, BackendDlcBinding>();
  private initialized = false;
  private offViewRemoved?: () => void;

  constructor(
    @inject(PackageCatalog) private readonly catalog: PackageCatalog,
    @inject(ViewManager) private readonly views: ViewManager,
    @inject(PLATFORM_RESOURCES)
    private readonly protocols: ResourceProtocolPort,
  ) {}

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.protocols.handle(
      SCHEME,
      (request) => this.authorize(request),
      (request) => this.serve(request),
    );
    this.offViewRemoved = this.views.on("view-removed", ({ appId }) =>
      this.revokeApp(appId),
    );
  }

  list(hostAppId: string, webContentsId?: number): DlcResource[] {
    const manifests = this.catalog.dlcsForHost(hostAppId);
    if (webContentsId === undefined) {
      const binding =
        this.backendBindings.get(hostAppId) ??
        this.createBackendBinding(hostAppId);
      return manifests.map((manifest) => ({
        manifest,
        rootUrl: this.rootUrl(binding.capability, manifest.id),
      }));
    }

    const capability = this.getOrCreateCapability(hostAppId, webContentsId);
    return manifests.map((manifest) => ({
      manifest,
      rootUrl: this.rootUrl(capability, manifest.id),
    }));
  }

  createBackendBinding(appId: string): BackendDlcBinding {
    const roots = Object.fromEntries(
      this.catalog.dlcsForHost(appId).map((manifest) => {
        const root = this.catalog.getPath(manifest.id);
        if (!root) throw new Error(`DLC ${manifest.id} is not installed`);
        return [manifest.id, root];
      }),
    );
    const binding = {
      capability: randomBytes(32).toString("base64url"),
      roots,
    };
    this.backendBindings.set(appId, binding);
    return structuredClone(binding);
  }

  revokeBackend(appId: string): void {
    this.backendBindings.delete(appId);
  }

  dispose(): void {
    if (!this.initialized) return;
    this.initialized = false;
    this.offViewRemoved?.();
    this.offViewRemoved = undefined;
    this.capabilities.clear();
    this.capabilityByView.clear();
    this.backendBindings.clear();
    this.protocols.unhandle(SCHEME);
  }

  private getOrCreateCapability(appId: string, webContentsId: number): string {
    const existing = this.capabilityByView.get(webContentsId);
    if (existing) {
      const binding = this.capabilities.get(existing);
      if (binding?.appId !== appId) {
        throw new Error("DLC resource capability has a conflicting app owner");
      }
      return existing;
    }
    const capability = randomBytes(32).toString("base64url");
    this.capabilities.set(capability, { appId, webContentsId });
    this.capabilityByView.set(webContentsId, capability);
    return capability;
  }

  private revokeApp(appId: string): void {
    for (const [capability, binding] of this.capabilities) {
      if (binding.appId !== appId) continue;
      this.capabilities.delete(capability);
      this.capabilityByView.delete(binding.webContentsId);
    }
  }

  private authorize(request: PlatformProtocolRequest): boolean {
    if (request.method !== "GET" && request.method !== "HEAD") return false;
    if (request.webContentsId === undefined) return false;
    const route = this.parseRoute(request.url);
    if (!route) return false;
    const binding = this.capabilities.get(route.capability);
    if (!binding || binding.webContentsId !== request.webContentsId) {
      return false;
    }
    const manifest = this.catalog.getDlc(route.dlcId);
    return manifest?.hostAppId === binding.appId;
  }

  private async serve(request: PlatformProtocolRequest) {
    try {
      const route = this.parseRoute(request.url);
      if (!route?.relativePath) return { status: 404 };
      const filePath = await this.catalog.resolveContainedDlcPath(
        route.dlcId,
        route.relativePath,
      );
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) return { status: 404 };
      return {
        status: 200,
        filePath,
        headers: {
          "Content-Type": this.mimeType(filePath),
          "X-Content-Type-Options": "nosniff",
          "Cross-Origin-Resource-Policy": "cross-origin",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "private, max-age=31536000, immutable",
        },
      };
    } catch {
      return { status: 404 };
    }
  }

  private parseRoute(urlValue: string): {
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

  private rootUrl(capability: string, dlcId: string): string {
    return `${SCHEME}://${AUTHORITY}/${capability}/${encodeURIComponent(dlcId)}/`;
  }

  private mimeType(filePath: string): string {
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
}
