/**
 * AppBus Type Definitions
 *
 * Interface for app-to-app communication.
 * Used by both frontend (window.appBus) and backend (worker.appBus).
 */

/**
 * Schema for fire-and-forget messages (send/on/once)
 * Keys are method names, values are the payload types
 */
export type MessageSchema = Record<string, any>;

/**
 * Schema for request/response (request/handle)
 * Keys are method names, values are { args, result } types
 */
export type RequestSchema = Record<string, { args: any; result: any }>;

/**
 * Defines a bidirectional communication protocol between two sides.
 * Use "host" for the side that exposes the service (exposeService).
 * Use "peer" for the side that connects to the service (connect).
 *
 * @example
 * type ChatProtocol = {
 *   // Messages the host sends, peer receives
 *   hostMessages: {
 *     'welcome': { text: string };
 *     'userJoined': { nickname: string };
 *   };
 *   // Messages the peer sends, host receives
 *   peerMessages: {
 *     'typing': { isTyping: boolean };
 *   };
 *   // Requests the host handles (peer calls request, host calls handle)
 *   hostHandles: {
 *     'join': { args: { nickname: string }; result: { success: boolean } };
 *     'sendMessage': { args: { text: string }; result: void };
 *   };
 *   // Requests the peer handles (host calls request, peer calls handle)
 *   peerHandles: {
 *     'ping': { args: {}; result: { pong: boolean } };
 *   };
 * };
 */
export interface ChannelProtocol {
  /** Messages sent by host, received by peer */
  hostMessages: MessageSchema;
  /** Messages sent by peer, received by host */
  peerMessages: MessageSchema;
  /** Requests that peer sends, host handles */
  hostHandles: RequestSchema;
  /** Requests that host sends, peer handles */
  peerHandles: RequestSchema;
}

/**
 * Default empty protocol (all any)
 */
type DefaultProtocol = {
  hostMessages: MessageSchema;
  peerMessages: MessageSchema;
  hostHandles: RequestSchema;
  peerHandles: RequestSchema;
};

/**
 * AppBus connection from the HOST perspective (the side that exposes the service).
 * - send() sends hostMessages
 * - on()/once() receives peerMessages
 * - request() calls peerHandles
 * - handle() implements hostHandles
 */
export type HostConnection<P extends ChannelProtocol> = AppBusConnection<
  P["hostMessages"],
  P["peerMessages"],
  P["peerHandles"],
  P["hostHandles"]
>;

/**
 * AppBus connection from the PEER perspective (the side that connects).
 * - send() sends peerMessages
 * - on()/once() receives hostMessages
 * - request() calls hostHandles
 * - handle() implements peerHandles
 */
export type PeerConnection<P extends ChannelProtocol> = AppBusConnection<
  P["peerMessages"],
  P["hostMessages"],
  P["hostHandles"],
  P["peerHandles"]
>;

/**
 * AppBus connection returned by connect()
 * Also used for frontend<->backend communication (appAPI)
 *
 * @typeParam TSend - Messages this side sends
 * @typeParam TReceive - Messages this side receives
 * @typeParam TRequest - Requests this side makes (other side handles)
 * @typeParam THandle - Requests this side handles (other side makes)
 *
 * For typed connections, use HostConnection<Protocol> or PeerConnection<Protocol>
 * which automatically flip the perspective.
 */
export interface AppBusConnection<
  TSend extends MessageSchema = MessageSchema,
  TReceive extends MessageSchema = MessageSchema,
  TRequest extends RequestSchema = RequestSchema,
  THandle extends RequestSchema = RequestSchema,
> {
  /** Send a fire-and-forget message */
  send<K extends keyof TSend>(method: K, args?: TSend[K]): void;

  /** Listen for messages from the other side */
  on<K extends keyof TReceive>(
    method: K,
    callback: (args: TReceive[K]) => void
  ): void;
  /** Listen for messages only once, then auto-remove */
  once<K extends keyof TReceive>(
    method: K,
    callback: (args: TReceive[K]) => void
  ): void;
  /** Remove a listener */
  off<K extends keyof TReceive>(
    method: K,
    callback: (args: TReceive[K]) => void
  ): void;

  /** Send a request and wait for response (other side handles) */
  request<K extends keyof TRequest>(
    method: K,
    args?: TRequest[K]["args"]
  ): Promise<TRequest[K]["result"]>;

  /** Register a handler for requests from the other side */
  handle<K extends keyof THandle>(
    method: K,
    handler: (
      args: THandle[K]["args"]
    ) => THandle[K]["result"] | Promise<THandle[K]["result"]>
  ): void;
  /** Remove a handler */
  removeHandler<K extends keyof THandle>(method: K): void;

  /** Check if the connection is active */
  isConnected: () => boolean;
  /** Register a callback for when the connection closes */
  onClose: (callback: () => void) => void;
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
