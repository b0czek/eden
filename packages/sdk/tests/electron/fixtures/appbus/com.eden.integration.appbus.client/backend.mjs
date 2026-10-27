await worker.appBus.exposeService("backend-reverse", (connection, client) => {
  connection.handle("echo", (payload) => ({
    payload,
    client: client.appId,
    provider: "client backend",
  }));
});
setInterval(() => undefined, 60_000).unref();
