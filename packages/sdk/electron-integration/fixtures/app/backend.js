setInterval(() => undefined, 60_000).unref();

void (async () => {
  const resultPath = require("node:path").join(
    process.env.EDEN_INSTALL_PATH,
    "backend-dlc-result.json",
  );
  try {
    const { dlcs: resources } = await worker.edenAPI.shellCommand(
      "package/self",
      {},
    );
    const resource = resources.find(
      (candidate) =>
        candidate.manifest.id === "com.eden.integration.fixture.module",
    );
    const entry = resource.manifest.contributions[0].metadata.entry;
    const module = await import(new URL(entry, resource.rootUrl).href);
    await require("node:fs/promises").writeFile(
      resultPath,
      JSON.stringify({
        asset: module.asset,
        moduleUrl: module.moduleUrl,
        rootUrl: resource.rootUrl,
        value: module.default,
      }),
    );
  } catch (error) {
    await require("node:fs/promises").writeFile(
      resultPath,
      JSON.stringify({ error: String(error?.stack ?? error) }),
    );
  }
})();
