/**
 * Hello World Backend
 *
 * This runs in a utility process and uses the global worker API.
 * worker.getAppAPI() returns the connection immediately (ready by the time this runs).
 */

import type { HostConnection } from "@edenapp/types/ipc";
import type { HelloProtocol } from "../../shared/protocol";

const appId = process.env.EDEN_APP_ID;
console.log(`Hello World backend starting for ${appId}`);
console.log("Install path:", process.env.EDEN_INSTALL_PATH);

// State
let messageCount = 0;

// Get the typed appAPI connection (Backend = Host)
const appAPI = worker!.getAppAPI() as HostConnection<HelloProtocol>;

// Register request handlers - fully typed!
appAPI.handle("ping", (_payload) => {
  messageCount++;
  return {
    timestamp: Date.now(),
    messageCount,
  };
});

appAPI.handle("get-status", (_payload) => {
  return {
    status: "running",
    uptime: process.uptime(),
    messageCount,
  };
});

appAPI.handle("hello", (payload) => {
  // payload.message is typed as string
  return {
    message: `Hello from backend! You said: ${payload.message}`,
  };
});

// Send a startup message - typed!
appAPI.send("backend-ready", {
  message: "Hello World backend is ready!",
});

// Periodic heartbeat
setInterval(() => {
  appAPI.send("heartbeat", {
    timestamp: Date.now(),
    messageCount,
  });
}, 10000);

console.log("Hello World backend initialized");
