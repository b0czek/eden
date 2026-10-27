const clientId = "com.eden.integration.appbus.client";
const providerId = "com.eden.integration.appbus.provider";
async function request(appId, service, payload) {
  const peer = await worker.appBus.connect(appId, service);
  if ("error" in peer) throw new Error(peer.error);
  try {
    return await peer.request("echo", payload);
  } finally {
    peer.close();
  }
}
const serve = (connection, client) => {
  connection.handle("echo", (payload) => ({
    payload,
    client: client.appId,
    provider: "backend",
  }));
  connection.handle("roundtrip", (payload) =>
    request(clientId, "reverse", payload),
  );
  connection.handle("backend-roundtrip", (payload) =>
    request(clientId, "backend-reverse", payload),
  );
};
await worker.appBus.exposeService("backend", serve, {
  allowedClients: [clientId],
});
await worker.appBus.exposeService("restricted", serve, {
  allowedClients: [providerId],
});
setInterval(() => undefined, 60_000).unref();
