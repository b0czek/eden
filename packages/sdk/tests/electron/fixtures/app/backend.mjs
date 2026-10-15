import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as client from "./client.mjs";

setInterval(() => undefined, 60_000).unref();

void (async () => {
  const resultPath = path.join(
    process.env.EDEN_INSTALL_PATH,
    "backend-dlc-result.json",
  );
  try {
    const { dlcs: resources } = await client.package.self();
    const resource = resources.find(
      (candidate) =>
        candidate.manifest.id === "com.eden.integration.fixture.module",
    );
    const entry = resource.manifest.contributions[0].metadata.entry;
    const module = await import(new URL(entry, resource.rootUrl).href);
    const binary = await client.fs.readBinary({
      volume: "home",
      path: "/binary-input.bin",
    });
    await fs.writeFile(
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
    await fs.writeFile(
      resultPath,
      JSON.stringify({ error: String(error?.stack ?? error) }),
    );
  }
})();

void (async () => {
  let started = false;
  await worker.edenAPI.subscribe("volume/changed", async ({ volumes }) => {
    if (started || !volumes.some((volume) => volume.id === "operation-delay"))
      return;
    started = true;
    let result;
    try {
      const operation = await worker.edenAPI.shellCommand(
        "integration/delayed",
        {
          name: "backend",
        },
      );
      await fs.writeFile(
        path.join(
          process.env.EDEN_INSTALL_PATH,
          "backend-operation-accepted.json",
        ),
        JSON.stringify(operation.handle),
      );
      const revisions = [];
      const stop = await operation.watch((snapshot) => {
        revisions.push(snapshot.revision);
        if (
          snapshot.status === "running" &&
          snapshot.phase === "waiting-for-fixture"
        ) {
          void fs.writeFile(
            path.join(
              process.env.EDEN_INSTALL_PATH,
              "backend-operation-progress.json",
            ),
            JSON.stringify(snapshot),
          );
        }
      });
      const completion = await operation.result();
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
  await worker.edenAPI.subscribe("volume/changed", async ({ volumes }) => {
    if (
      !volumes.some(
        (volume) => volume.id === "slow-eject" && volume.state === "ready",
      )
    )
      return;
    let result;
    try {
      const operation = await client.volume.eject("slow-eject");
      await fs.writeFile(
        path.join(process.env.EDEN_INSTALL_PATH, "backend-eject-accepted.json"),
        JSON.stringify(operation.handle),
      );
      await operation.result();
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
