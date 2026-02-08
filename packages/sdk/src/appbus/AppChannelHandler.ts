import type { ConnectResult, ServiceInfo } from "@edenapp/types";
import { EdenHandler, EdenNamespace } from "../ipc";
import type { AppChannelManager } from "./AppChannelManager";

/**
 * AppChannelHandler
 *
 * IPC handler for AppBus operations.
 * Exposes service registration and channel connection
 * via Eden's decorator-based IPC system.
 */
@EdenNamespace("appbus")
export class AppChannelHandler {
  constructor(private channelManager: AppChannelManager) {}

  // ===================================================================
  // Service Registration
  // ===================================================================

  /**
   * Register a service that this app exposes
   * Requires "appbus/expose" permission
   */
  @EdenHandler("register", { permission: "expose" })
  async handleRegister(args: {
    serviceName: string;
    description?: string;
    allowedClients?: string[];
    _callerAppId: string;
    _callerWebContentsId: number;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      this.channelManager.registerService(
        args._callerAppId,
        args.serviceName,
        args._callerWebContentsId,
        {
          description: args.description,
          allowedClients: args.allowedClients,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Unregister a service
   * Requires "appbus/expose" permission
   */
  @EdenHandler("unregister", { permission: "expose" })
  async handleUnregister(args: {
    serviceName: string;
    _callerAppId: string;
  }): Promise<{ success: boolean }> {
    const deleted = this.channelManager.unregisterService(
      args._callerAppId,
      args.serviceName,
    );
    return { success: deleted };
  }

  // ===================================================================
  // Service Discovery
  // ===================================================================

  /**
   * List all available services
   * No permission required
   */
  @EdenHandler("list")
  async handleList(): Promise<{ services: ServiceInfo[] }> {
    return { services: this.channelManager.listServices() };
  }

  /**
   * List services by app ID
   * No permission required
   */
  @EdenHandler("list-by-app")
  async handleListByApp(args: {
    appId: string;
  }): Promise<{ services: ServiceInfo[] }> {
    return { services: this.channelManager.getServicesByApp(args.appId) };
  }

  // ===================================================================
  // Channel Connection
  // ===================================================================

  /**
   * Connect to another app's service
   * Creates MessageChannel and transfers ports directly to both apps
   * Requires "appbus/connect" permission
   */
  @EdenHandler("connect", { permission: "connect" })
  async handleConnect(args: {
    targetAppId: string;
    serviceName: string;
    _callerAppId: string;
    _callerWebContentsId: number;
  }): Promise<ConnectResult> {
    return this.channelManager.connect(
      args._callerAppId,
      args._callerWebContentsId,
      args.targetAppId,
      args.serviceName,
    );
  }
}
