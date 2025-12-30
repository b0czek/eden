import { MessageChannelMain, webContents } from "electron";
import { inject, injectable } from "tsyringe";
import type {
  RegisteredService,
  ServiceInfo,
  ConnectResult,
} from "@edenapp/types/channels";
import { CommandRegistry } from "../ipc";
import { AppChannelHandler } from "./AppChannelHandler";

/**
 * AppChannelManager
 *
 * Central manager for peer-to-peer channels between apps.
 * Uses Electron's MessageChannelMain for direct communication
 * that bypasses the main process after initial setup.
 */
@injectable()
export class AppChannelManager {
  /** Map of "appId:serviceName" -> RegisteredService */
  private services: Map<string, RegisteredService> = new Map();

  /** Active connections for cleanup tracking */
  private connections: Map<
    string,
    { port1: Electron.MessagePortMain; port2: Electron.MessagePortMain }
  > = new Map();

  /** IPC handler for appbus/* commands */
  private handler: AppChannelHandler;

  constructor(@inject("CommandRegistry") commandRegistry: CommandRegistry) {
    this.handler = new AppChannelHandler(this);
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
    methods: string[],
    webContentsId: number,
    options?: { description?: string; allowedClients?: string[] }
  ): void {
    const key = this.serviceKey(appId, serviceName);

    if (this.services.has(key)) {
      throw new Error(
        `Service "${serviceName}" is already registered by app "${appId}"`
      );
    }

    const service: RegisteredService = {
      appId,
      serviceName,
      methods,
      webContentsId,
      description: options?.description,
      allowedClients: options?.allowedClients,
    };

    this.services.set(key, service);
    console.log(
      `[AppChannelManager] Registered service "${serviceName}" from app "${appId}" with methods: ${methods.join(
        ", "
      )}`
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
    const requesterWebContents = webContents.fromId(requesterWebContentsId);
    const targetWebContents = webContents.fromId(service.webContentsId);

    if (!requesterWebContents) {
      return { success: false, error: "Requester view not found" };
    }

    if (!targetWebContents) {
      return {
        success: false,
        error: `Target app "${targetAppId}" is not running`,
      };
    }

    // Create MessageChannel for peer-to-peer communication
    const { port1, port2 } = new MessageChannelMain();
    const connectionId = `${requesterAppId}->${targetAppId}:${serviceName}:${Date.now()}`;

    // Store for cleanup
    this.connections.set(connectionId, { port1, port2 });

    console.log(
      `[AppChannelManager] Creating channel: ${requesterAppId} -> ${targetAppId}:${serviceName}`
    );

    // Transfer port1 to requester (the one who initiated the connection)
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

    // Transfer port2 to target (the service provider)
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

    try {
      connection.port1.close();
      connection.port2.close();
    } catch (e) {
      // Ports may already be closed
    }

    this.connections.delete(connectionId);
    console.log(`[AppChannelManager] Closed connection: ${connectionId}`);
    return true;
  }

  /**
   * List all registered services
   */
  listServices(): ServiceInfo[] {
    return Array.from(this.services.values()).map((service) => ({
      appId: service.appId,
      serviceName: service.serviceName,
      methods: service.methods,
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
