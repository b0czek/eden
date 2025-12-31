/**
 * AppBus Type Definitions
 *
 * Interface for app-to-app communication.
 * Used by both frontend (window.appBus) and backend (worker.appBus).
 */

/**
 * AppBus connection returned by connect()
 */
export interface AppBusConnection {
  /** Send a fire-and-forget message */
  send: (method: string, args?: any) => void;
  /** Send a request and wait for response */
  request: (method: string, args?: any) => Promise<any>;
  /** Close the connection */
  close: () => void;
}

/**
 * Service handler function type
 */
export type ServiceHandler = (method: string, args: any) => any | Promise<any>;

/**
 * Service registration options
 */
export interface ServiceOptions {
  description?: string;
  allowedClients?: string[];
  methods?: string[];
}

/**
 * Service info returned by listServices
 */
export interface ServiceInfo {
  appId: string;
  serviceName: string;
  methods: string[];
  description?: string;
}

/**
 * AppBus API - app-to-app communication
 */
export interface AppBusAPI {
  /**
   * Register a service that other apps can connect to
   * @param serviceName - Name of the service
   * @param handler - Function to handle incoming method calls
   * @param options - Optional configuration
   */
  exposeService(
    serviceName: string,
    handler: ServiceHandler,
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
