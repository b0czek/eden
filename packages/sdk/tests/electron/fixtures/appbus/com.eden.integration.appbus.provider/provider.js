window.appBusReady = window.appBus.exposeService(
  "frontend",
  (connection, client) => {
    connection.handle("echo", (payload) => ({
      payload,
      client: client.appId,
      provider: "frontend",
    }));
  },
);
