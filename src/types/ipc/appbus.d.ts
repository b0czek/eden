/**
 * AppBus Type Definitions
 *
 * Interface for app-to-app communication.
 * Used by both frontend (window.appBus) and backend (worker.appBus).
 */

/**
 * AppBus connection returned by connect()
 * Also used for frontend<->backend communication (appAPI)
 */
export interface AppBusConnection {
  /** Send a fire-and-forget message */
  send: (method: string, args?: any) => void;
  /** Listen for send() messages for a specific method */
  on: (method: string, callback: (args: any) => void) => void;
  /** Remove a listener for a specific method */
  off: (method: string, callback: (args: any) => void) => void;

  /** Send a request and wait for response */
  request: (method: string, args?: any) => Promise<any>;
  /** Register a handler for request() calls for a specific method */
  handle: (method: string, handler: (args: any) => any | Promise<any>) => void;
  /** Remove the handler for a specific method */
  removeHandler: (method: string) => void;

  /** Check if the connection is active */
  isConnected: () => boolean;
  /** Close the connection */
  close: () => void;
}

/**
 * Information about a connecting client
 */
export interface ClientInfo {
  appId: string;
}

/**
 * Callback invoked when a client connects to a service
 */
export type ServiceConnectCallback = (
  connection: AppBusConnection,
  clientInfo: ClientInfo
) => void;

/**
 * Service registration options
 */
export interface ServiceOptions {
  description?: string;
  allowedClients?: string[];
}

/**
 * Service info returned by listServices
 */
export interface ServiceInfo {
  appId: string;
  serviceName: string;
  description?: string;
}

/**
 * AppBus API - app-to-app communication
 */
export interface AppBusAPI {
  /**
   * Register a service that other apps can connect to.
   * When a client connects, onConnect is called with their AppBusConnection.
   * @param serviceName - Name of the service
   * @param onConnect - Callback invoked for each connecting client with their bidirectional connection
   * @param options - Optional configuration
   */
  exposeService(
    serviceName: string,
    onConnect: ServiceConnectCallback,
    options?: ServiceOptions
  ): Promise<{ success: boolean; error?: string }>;

  /**
   * Unregister a service
   * @param serviceName - Name of the service to unregister
   */
  unexposeService(serviceName: string): Promise<{ success: boolean }>;

  /**
   * Connect to another app's service
   * @param targetAppId - App ID of the target app
   * @param serviceName - Name of the service to connect to
   */
  connect(
    targetAppId: string,
    serviceName: string
  ): Promise<AppBusConnection | { error: string }>;

  /**
   * List all available services
   */
  listServices(): Promise<{ services: ServiceInfo[] }>;

  /**
   * List services exposed by a specific app
   * @param appId - App ID to query
   */
  listServicesByApp(appId: string): Promise<{ services: ServiceInfo[] }>;
}
