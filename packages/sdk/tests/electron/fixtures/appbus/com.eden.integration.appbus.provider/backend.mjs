const clientId = "com.eden.integration.appbus.client";
const serve = (connection, client) => {
  connection.handle("echo", (payload) => ({
    payload,
    client: client.appId,
    provider: "backend",
  }));
  connection.handle("roundtrip", async (payload) => {
    const peer = await worker.appBus.connect(clientId, "reverse");
    if ("error" in peer) throw new Error(peer.error);
    try {
      return await peer.request("echo", payload);
    } finally {
      peer.close();
    }
  });
};
await worker.appBus.exposeService("backend", serve, {
  allowedClients: [clientId],
});
await worker.appBus.exposeService("restricted", serve, {
  allowedClients: ["com.eden.integration.appbus.provider"],
});
setInterval(() => undefined, 60_000).unref();
