/**
 * Hello App Protocol
 *
 * Defines the typed contract between frontend and backend.
 * This is the single source of truth for all communication.
 */

import type { ChannelProtocol } from "@edenapp/types/ipc";

/**
 * Protocol for frontend <-> backend communication in Hello World app.
 *
 * Host = Backend (exposes the appAPI connection)
 * Peer = Frontend (connects via getAppAPI())
 */
export interface HelloProtocol extends ChannelProtocol {
  // Messages sent by backend, received by frontend
  hostMessages: {
    "backend-ready": { message: string };
    heartbeat: { timestamp: number; messageCount: number };
  };

  // Messages sent by frontend, received by backend
  peerMessages: {};

  // Requests that frontend sends, backend handles
  hostHandles: {
    ping: { args: {}; result: { timestamp: number; messageCount: number } };
    "get-status": {
      args: {};
      result: { status: string; uptime: number; messageCount: number };
    };
    hello: { args: { message: string }; result: { message: string } };
  };

  // Requests that backend sends, frontend handles (none in this app)
  peerHandles: {};
}
