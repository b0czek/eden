// AppBus Chat Hub - Backend Mediator
// Routes messages between connected clients using bidirectional connections

const appId = process.env.EDEN_APP_ID;
console.log(`[Hub] Starting chat hub for ${appId}`);

// Connected clients map: appId -> { connection, nickname }
const clients = new Map();

// Expose the chat-relay service
// When a client connects, we receive their AppBusConnection
worker.appBus.exposeService(
  "chat-relay",
  (connection, { appId: clientAppId }) => {
    console.log(`[Hub] Client connecting: ${clientAppId}`);

    // Store the connection (nickname will be set on join)
    clients.set(clientAppId, { connection, nickname: clientAppId });

    // Handle client disconnect
    connection.onClose(() => {
      const client = clients.get(clientAppId);
      if (client) {
        console.log(
          `[Hub] Client disconnected: ${client.nickname} (${clientAppId})`,
        );
        clients.delete(clientAppId);
        broadcastToOthers(clientAppId, "client-left", {
          clientId: clientAppId,
          nickname: client.nickname,
        });
      }
    });

    // Handle join request
    connection.handle("join", ({ clientId, nickname }) => {
      clients.set(clientAppId, { connection, nickname });
      console.log(`[Hub] Client joined: ${nickname} (${clientAppId})`);

      // Notify all other clients
      broadcastToOthers(clientAppId, "client-joined", {
        clientId: clientAppId,
        nickname,
      });

      return {
        success: true,
        clients: getClientList(),
      };
    });

    // Handle send-message request
    connection.handle("send-message", ({ clientId, message }) => {
      const client = clients.get(clientAppId);
      if (!client) {
        return { success: false, error: "Not joined" };
      }

      const chatMessage = {
        from: clientAppId,
        nickname: client.nickname,
        message,
        timestamp: Date.now(),
      };

      console.log(
        `[Hub] Broadcasting message from ${client.nickname}: ${message}`,
      );

      // Broadcast to all clients (including sender for confirmation)
      broadcast("chat-message", chatMessage);

      return { success: true };
    });

    // Handle leave request
    connection.handle("leave", ({ clientId }) => {
      const client = clients.get(clientAppId);
      if (client) {
        clients.delete(clientAppId);
        broadcastToOthers(clientAppId, "client-left", {
          clientId: clientAppId,
          nickname: client.nickname,
        });
      }
      return { success: true };
    });

    // Handle list-clients request
    connection.handle("list-clients", () => {
      return { clients: getClientList() };
    });
  },
  {
    description: "Chat relay service for hub-mediated messaging",
  },
);

// Helper: Get list of connected clients
function getClientList() {
  return Array.from(clients.entries()).map(([id, info]) => ({
    clientId: id,
    nickname: info.nickname,
  }));
}

// Helper: Broadcast to all connected clients
function broadcast(eventName, data) {
  clients.forEach(({ connection }, clientId) => {
    try {
      connection.send(eventName, data);
    } catch (err) {
      console.error(`[Hub] Error sending to ${clientId}:`, err);
    }
  });
}

// Helper: Broadcast to all except one client
function broadcastToOthers(excludeClientId, eventName, data) {
  clients.forEach(({ connection }, clientId) => {
    if (clientId !== excludeClientId) {
      try {
        connection.send(eventName, data);
      } catch (err) {
        console.error(`[Hub] Error sending to ${clientId}:`, err);
      }
    }
  });
}

console.log("[Hub] Chat relay service exposed and ready");
