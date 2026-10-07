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
    const binary = await worker.edenAPI.shellCommand("fs/read-binary", {
      location: { volume: "home", path: "/binary-input.bin" },
    });
    await require("node:fs/promises").writeFile(
      resultPath,
      JSON.stringify({
        asset: module.asset,
        binary: {
          bytes: [...binary],
          isUint8Array: binary instanceof Uint8Array,
        },
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

void (async () => {
  const fs = require("node:fs/promises");
  const path = require("node:path");
  let started = false;
  await worker.edenAPI.subscribe("fs/volumes-changed", async ({ volumes }) => {
    if (started || !volumes.some((volume) => volume.id === "operation-delay"))
      return;
    started = true;
    let result;
    try {
      const handle = await worker.edenAPI.shellCommand("integration/delayed", {
        name: "backend",
      });
      await fs.writeFile(
        path.join(
          process.env.EDEN_INSTALL_PATH,
          "backend-operation-accepted.json",
        ),
        JSON.stringify(handle),
      );
      const revisions = [];
      const stop = await worker.edenAPI.operations.watch(handle, (snapshot) =>
        revisions.push(snapshot.revision),
      );
      const completion = await worker.edenAPI.operations.wait(handle);
      stop();
      result = { completion, revisions };
    } catch (error) {
      result = { error: String(error) };
    }
    await fs.writeFile(
      path.join(process.env.EDEN_INSTALL_PATH, "backend-operation-result.json"),
      JSON.stringify(result),
    );
  });
  await fs.writeFile(
    path.join(process.env.EDEN_INSTALL_PATH, "backend-operation-ready"),
    "ready",
  );
})();

void (async () => {
  const fs = require("node:fs/promises");
  const path = require("node:path");
  await worker.edenAPI.subscribe("fs/volumes-changed", async ({ volumes }) => {
    if (
      !volumes.some(
        (volume) => volume.id === "slow-eject" && volume.state === "ready",
      )
    )
      return;
    let result;
    try {
      const handle = await worker.edenAPI.shellCommand("fs/eject", {
        volume: "slow-eject",
      });
      await fs.writeFile(
        path.join(process.env.EDEN_INSTALL_PATH, "backend-eject-accepted.json"),
        JSON.stringify(handle),
      );
      await worker.edenAPI.operations.wait(handle);
      result = { success: true };
    } catch (error) {
      result = { error: String(error) };
    }
    await fs.writeFile(
      path.join(process.env.EDEN_INSTALL_PATH, "backend-eject-result.json"),
      JSON.stringify(result),
    );
  });
  await fs.writeFile(
    path.join(process.env.EDEN_INSTALL_PATH, "backend-eject-ready"),
    "ready",
  );
})();
