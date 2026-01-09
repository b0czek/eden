import { MessageChannelMain, webContents } from "electron";
import { inject, injectable, singleton, delay } from "tsyringe";
import type {
  RegisteredService,
  ServiceInfo,
  ConnectResult,
} from "@edenapp/types";
import { CommandRegistry } from "../ipc";
import { AppChannelHandler } from "./AppChannelHandler";
import { BackendManager } from "../process-manager/BackendManager";

/**
 * AppChannelManager
 *
 * Central manager for peer-to-peer channels between apps.
 * Uses Electron's MessageChannelMain for direct communication
 * that bypasses the main process after initial setup.
 */
@singleton()
@injectable()
export class AppChannelManager {
  /** Map of "appId:serviceName" -> RegisteredService */
  private services: Map<string, RegisteredService> = new Map();

  /** Active connections for cleanup tracking */
  private connections: Map<
    string,
    {
      requesterAppId: string;
      requesterWebContentsId?: number;
      targetAppId: string;
      targetWebContentsId?: number;
    }
  > = new Map();

  /** IPC handler for appbus/* commands */
  private handler: AppChannelHandler;
  private backendManager: BackendManager;

  constructor(
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject(delay(() => BackendManager)) backendManager: BackendManager
  ) {
    this.handler = new AppChannelHandler(this);
    this.backendManager = backendManager;
    commandRegistry.registerManager(this.handler);
  }

  /**
   * Generate a unique key for a service
   */
  private serviceKey(appId: string, serviceName: string): string {
    return `${appId}:${serviceName}`;
  }

  /**
   * Register a service that an app exposes
   */
  registerService(
    appId: string,
    serviceName: string,
    webContentsId: number,
    options?: { description?: string; allowedClients?: string[] }
  ): void {
    const key = this.serviceKey(appId, serviceName);

    if (this.services.has(key)) {
      throw new Error(
        `Service "${serviceName}" is already registered by app "${appId}"`
      );
    }

    // Determine if provider is frontend or backend
    // If webContentsId is -1 or invalid, assume backend
    const providerType =
      webContentsId && webContentsId > 0 ? "frontend" : "backend";

    const service: RegisteredService = {
      appId,
      serviceName,
      webContentsId: providerType === "frontend" ? webContentsId : undefined,
      providerType,
      description: options?.description,
      allowedClients: options?.allowedClients,
    };

    this.services.set(key, service);
    console.log(
      `[AppChannelManager] Registered service "${serviceName}" from app "${appId}"`
    );
  }

  /**
   * Unregister a service
   */
  unregisterService(appId: string, serviceName: string): boolean {
    const key = this.serviceKey(appId, serviceName);
    const deleted = this.services.delete(key);

    if (deleted) {
      console.log(
        `[AppChannelManager] Unregistered service "${serviceName}" from app "${appId}"`
      );
    }

    return deleted;
  }

  /**
   * Unregister all services from an app (called when app stops)
   */
  unregisterAllServices(appId: string): number {
    let count = 0;
    for (const [key, service] of this.services) {
      if (service.appId === appId) {
        this.services.delete(key);
        count++;
      }
    }

    if (count > 0) {
      console.log(
        `[AppChannelManager] Unregistered ${count} services from app "${appId}"`
      );
    }

    // Also close all active connections for this app
    this.closeConnectionsForApp(appId);

    return count;
  }

  /**
   * Get a registered service
   */
  getService(
    appId: string,
    serviceName: string
  ): RegisteredService | undefined {
    return this.services.get(this.serviceKey(appId, serviceName));
  }

  /**
   * Check if a client app is allowed to connect to a service
   */
  isClientAllowed(service: RegisteredService, clientAppId: string): boolean {
    // If no allowedClients specified, open to all
    if (!service.allowedClients || service.allowedClients.length === 0) {
      return true;
    }

    // Check if client is in the allowlist
    return service.allowedClients.includes(clientAppId);
  }

  /**
   * Connect to a service - creates MessageChannel and transfers ports directly
   */
  connect(
    requesterAppId: string,
    requesterWebContentsId: number,
    targetAppId: string,
    serviceName: string
  ): ConnectResult {
    const service = this.getService(targetAppId, serviceName);

    if (!service) {
      return {
        success: false,
        error: `Service "${serviceName}" not found on app "${targetAppId}"`,
      };
    }

    // Check if requester is allowed
    if (!this.isClientAllowed(service, requesterAppId)) {
      return {
        success: false,
        error: `App "${requesterAppId}" is not allowed to connect to service "${serviceName}"`,
      };
    }

    // Get webContents for both requester and target
    const requesterWebContents = requesterWebContentsId
      ? webContents.fromId(requesterWebContentsId)
      : undefined;
    const targetWebContents = service.webContentsId
      ? webContents.fromId(service.webContentsId)
      : undefined;

    // Validate requester (must be frontend or backend)
    const isRequesterBackend =
      !requesterWebContents && this.backendManager.hasBackend(requesterAppId);

    if (!requesterWebContents && !isRequesterBackend) {
      return { success: false, error: "Requester process not found" };
    }

    // Validate target (must be frontend or backend)
    const isTargetBackend =
      service.providerType === "backend" &&
      this.backendManager.hasBackend(targetAppId);

    if (service.providerType === "frontend" && !targetWebContents) {
      return {
        success: false,
        error: `Target app "${targetAppId}" frontend is not running`,
      };
    }

    if (service.providerType === "backend" && !isTargetBackend) {
      return {
        success: false,
        error: `Target app "${targetAppId}" backend is not running`,
      };
    }

    // Create MessageChannel for peer-to-peer communication
    const { port1, port2 } = new MessageChannelMain();
    const connectionId = `${requesterAppId}->${targetAppId}:${serviceName}:${Date.now()}`;

    this.connections.set(connectionId, {
      requesterAppId,
      requesterWebContentsId: requesterWebContentsId || undefined,
      targetAppId,
      targetWebContentsId: service.webContentsId,
    });

    console.log(
      `[AppChannelManager] Creating channel: ${requesterAppId} -> ${targetAppId}:${serviceName}`
    );

    // Transfer port1 to requester
    if (requesterWebContents) {
      requesterWebContents.postMessage(
        "appbus-port",
        {
          connectionId,
          targetAppId,
          serviceName,
          role: "client",
        },
        [port1]
      );
    } else {
      // Requester is backend
      this.backendManager.sendPortToBackend(
        requesterAppId,
        {
          type: "appbus-port",
          connectionId,
          targetAppId,
          serviceName,
          role: "client",
        },
        [port1]
      );
    }

    // Transfer port2 to target
    if (targetWebContents) {
      targetWebContents.postMessage(
        "appbus-port",
        {
          connectionId,
          sourceAppId: requesterAppId,
          serviceName,
          role: "service",
        },
        [port2]
      );
    } else {
      // Target is backend
      this.backendManager.sendPortToBackend(
        targetAppId,
        {
          type: "appbus-port",
          connectionId,
          sourceAppId: requesterAppId,
          serviceName,
          role: "service",
        },
        [port2]
      );
    }

    return { success: true, connectionId };
  }

  /**
   * Close a channel connection
   */
  closeConnection(connectionId: string): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return false;
    }

    this.connections.delete(connectionId);
    console.log(`[AppChannelManager] Closed connection: ${connectionId}`);
    return true;
  }

  /**
   * Close all connections for a specific app (called when app/backend stops)
   */
  closeConnectionsForApp(appId: string): void {
    const connectionsToClose: string[] = [];

    for (const [connectionId, conn] of this.connections) {
      if (conn.requesterAppId === appId || conn.targetAppId === appId) {
        connectionsToClose.push(connectionId);

        // Notify the OTHER side
        if (conn.requesterAppId === appId) {
          // Requester closed, notify target
          this.notifyPortClosed(
            conn.targetAppId,
            conn.targetWebContentsId,
            connectionId
          );
        } else {
          // Target closed, notify requester
          this.notifyPortClosed(
            conn.requesterAppId,
            conn.requesterWebContentsId,
            connectionId
          );
        }
      }
    }

    for (const connectionId of connectionsToClose) {
      this.closeConnection(connectionId);
    }
  }

  /**
   * Helper to notify a process that a port was closed
   */
  private notifyPortClosed(
    appId: string,
    webContentsId: number | undefined,
    connectionId: string
  ): void {
    console.log(
      `[AppChannelManager] Notifying port closed for app "${appId}" (webContentsId: ${webContentsId})`
    );
    if (webContentsId) {
      const wc = webContents.fromId(webContentsId);
      if (wc && !wc.isDestroyed()) {
        wc.send("appbus-port-closed", { connectionId });
      }
    } else {
      // It's a backend
      this.backendManager.sendMessage(appId, {
        type: "appbus-port-closed",
        connectionId,
      });
    }
  }

  /**
   * List all registered services
   */
  listServices(): ServiceInfo[] {
    return Array.from(this.services.values()).map((service) => ({
      appId: service.appId,
      serviceName: service.serviceName,
      description: service.description,
    }));
  }

  /**
   * Get services by app ID
   */
  getServicesByApp(appId: string): ServiceInfo[] {
    return this.listServices().filter((s) => s.appId === appId);
  }

  /**
   * Check if an app has any registered services
   */
  hasServices(appId: string): boolean {
    for (const service of this.services.values()) {
      if (service.appId === appId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Cleanup all connections and services
   */
  destroy(): void {
    // Close all connections
    for (const [connectionId] of this.connections) {
      this.closeConnection(connectionId);
    }

    this.services.clear();
    console.log("[AppChannelManager] Destroyed");
  }
}
