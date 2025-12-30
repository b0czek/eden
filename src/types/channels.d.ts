/**
 * AppBus Channel Types
 *
 * Types for the app-to-app communication system (Eden AppBus)
 */

/**
 * Information about a registered service
 */
export interface ServiceInfo {
  /** App that exposes this service */
  appId: string;
  /** Service name (unique per app) */
  serviceName: string;
  /** Methods this service exposes */
  methods: string[];
  /** Human-readable description */
  description?: string;
}

/**
 * Service declaration in app manifest
 */
export interface ServiceDeclaration {
  /** Service name (must be unique per app) */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Methods this service exposes */
  methods: string[];
  /** Optional: Restrict which apps can connect (if omitted, open to all) */
  allowedClients?: string[];
}

/**
 * A connected port to another app's service
 */
export interface AppBusPort {
  /** Send a request and wait for response */
  request: (method: string, args?: any) => Promise<any>;
  /** Send fire-and-forget message */
  send: (method: string, args?: any) => void;
  /** Listen for messages from connected service */
  onMessage: (callback: (method: string, args: any) => void) => void;
  /** Close the connection */
  close: () => void;
}

/**
 * Message sent over a channel
 */
export interface ChannelMessage {
  /** Message type: request (expects response) or message (fire-and-forget) */
  type: "request" | "response" | "message";
  /** Method name being called */
  method: string;
  /** Message payload */
  payload?: any;
  /** Unique ID for request/response correlation */
  messageId?: string;
  /** Error if response failed */
  error?: string;
}

/**
 * Result of a connect attempt
 */
export interface ConnectResult {
  success: boolean;
  error?: string;
  /** Connection ID (for internal tracking) */
  connectionId?: string;
}

/**
 * Registered service with internal details
 */
export interface RegisteredService {
  appId: string;
  serviceName: string;
  methods: string[];
  description?: string;
  allowedClients?: string[];
  webContentsId: number;
}
