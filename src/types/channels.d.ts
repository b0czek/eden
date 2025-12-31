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
  allowedClients?: string[];
  webContentsId?: number;
  providerType: "frontend" | "backend";
}
