import * as fs from "node:fs/promises";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import { build } from "esbuild";
import type { ElectronProfile } from "./profile";

export const APP_ID = "com.eden.integration.fixture";
export const DLC_ID = "com.eden.integration.fixture.module";
export const REMOTE_APP_ID = "com.eden.integration.remote";
export const REMOTE_DLC_ID = "com.eden.integration.remote.module";

const electronDirectory = path.join(__dirname, "..");

export async function prepareIntegrationFixture(profile: ElectronProfile) {
  const { fixtureDirectory, userDirectory, appsDirectory } = profile;
  const dlcDirectory = path.join(appsDirectory, ".dlcs", DLC_ID);
  await fs.mkdir(path.join(dlcDirectory, "dist"), { recursive: true });
  await fs.cp(path.join(electronDirectory, "fixtures/app"), fixtureDirectory, {
    recursive: true,
  });
  await build({
    entryPoints: [
      path.join(electronDirectory, "../../../client/dist/index.js"),
    ],
    outfile: path.join(fixtureDirectory, "client.mjs"),
    bundle: true,
    platform: "neutral",
    format: "esm",
    target: "es2022",
  });
  await fs.writeFile(
    path.join(userDirectory, "binary-input.bin"),
    new Uint8Array([0, 255, 128, 13, 10]),
  );
  await Promise.all([
    fs.writeFile(
      path.join(dlcDirectory, "manifest.json"),
      JSON.stringify({
        kind: "dlc",
        id: DLC_ID,
        name: "Electron Integration Module",
        version: "1.0.0",
        hostAppId: APP_ID,
        contributions: [
          {
            extensionPoint: "integration-module",
            requires: "^1.0.0",
            metadata: { entry: "dist/entry.mjs" },
          },
        ],
      }),
    ),
    fs.writeFile(
      path.join(dlcDirectory, "dist/dependency.mjs"),
      'export const value = "loaded-through-eden-dlc";',
    ),
    fs.writeFile(
      path.join(dlcDirectory, "dist/entry.mjs"),
      'import { value } from "./dependency.mjs"; export const moduleUrl = import.meta.url; export const asset = await (await fetch(new URL("./asset.txt", import.meta.url))).text(); export default value;',
    ),
    fs.writeFile(path.join(dlcDirectory, "dist/asset.txt"), "adjacent asset"),
  ]);
}

export async function prepareRemoteDlcFixture(profile: ElectronProfile) {
  const remoteFixtureDirectory = path.join(
    profile.root,
    "dist/apps/prebuilt",
    REMOTE_APP_ID,
  );
  const remoteDlcDirectory = path.join(
    profile.appsDirectory,
    ".dlcs",
    REMOTE_DLC_ID,
  );
  const server = http.createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' eden-dlc:; connect-src 'self' eden-dlc:",
    });
    response.end("<!doctype html><title>Remote DLC Fixture</title>");
  });
  profile.remoteServer = server;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  const remoteUrl = `http://127.0.0.1:${address.port}/`;
  profile.remoteUrl = remoteUrl;
  await fs.mkdir(remoteFixtureDirectory, { recursive: true });
  await fs.mkdir(path.join(remoteDlcDirectory, "dist"), { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(remoteFixtureDirectory, "manifest.json"),
      JSON.stringify({
        id: REMOTE_APP_ID,
        name: "Remote Electron Integration Fixture",
        version: "1.0.0",
        frontend: { entry: remoteUrl },
        dlc: {
          extensionPoints: [{ id: "integration-module", version: "1.0.0" }],
        },
      }),
    ),
    fs.writeFile(
      path.join(remoteDlcDirectory, "manifest.json"),
      JSON.stringify({
        kind: "dlc",
        id: REMOTE_DLC_ID,
        name: "Remote Electron Integration Module",
        version: "1.0.0",
        hostAppId: REMOTE_APP_ID,
        contributions: [
          {
            extensionPoint: "integration-module",
            requires: "^1.0.0",
            metadata: { entry: "dist/entry.mjs" },
          },
        ],
      }),
    ),
    fs.writeFile(
      path.join(remoteDlcDirectory, "dist/entry.mjs"),
      'export default "loaded-from-remote-host";',
    ),
  ]);
}
