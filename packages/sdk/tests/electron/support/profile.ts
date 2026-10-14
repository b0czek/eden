import * as fs from "node:fs/promises";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { build } from "esbuild";

export const APP_ID = "com.eden.integration.fixture";
export const PDF_VIEWER_APP_ID = "com.eden.pdf-viewer";
export const DLC_ID = "com.eden.integration.fixture.module";
export const REMOTE_APP_ID = "com.eden.integration.remote";
export const REMOTE_DLC_ID = "com.eden.integration.remote.module";

export interface ElectronProfile {
  root: string;
  appsDirectory: string;
  userDirectory: string;
  seedPath: string;
  fixtureDirectory: string;
  pdfViewerFixtureDirectory: string;
  remoteUrl: string;
  remoteServer: http.Server;
}

export async function createElectronProfile(): Promise<ElectronProfile> {
  const electronDirectory = path.join(__dirname, "..");
  let root = "";
  let fixtureDirectory = "";
  let pdfViewerFixtureDirectory = "";
  let remoteUrl = "";
  let remoteServer: http.Server | undefined;
  try {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "eden-electron-"));
    const appsDirectory = path.join(root, "apps");
    const userDirectory = path.join(root, "users");
    fixtureDirectory = path.join(root, "dist/apps/prebuilt", APP_ID);
    pdfViewerFixtureDirectory = path.join(
      root,
      "dist/apps/prebuilt",
      PDF_VIEWER_APP_ID,
    );
    const remoteFixtureDirectory = path.join(
      root,
      "dist/apps/prebuilt",
      REMOTE_APP_ID,
    );
    const dlcDirectory = path.join(appsDirectory, ".dlcs", DLC_ID);
    const remoteDlcDirectory = path.join(appsDirectory, ".dlcs", REMOTE_DLC_ID);
    remoteServer = http.createServer((_request, response) => {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self' eden-dlc:; connect-src 'self' eden-dlc:",
      });
      response.end("<!doctype html><title>Remote DLC Fixture</title>");
    });
    const server = remoteServer;
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const remoteAddress = remoteServer.address() as AddressInfo;
    remoteUrl = `http://127.0.0.1:${remoteAddress.port}/`;
    const seedPath = path.join(root, "eden-seed.json");
    await Promise.all([
      fs.mkdir(appsDirectory, { recursive: true }),
      fs.mkdir(userDirectory, { recursive: true }),
      fs.mkdir(path.dirname(fixtureDirectory), { recursive: true }),
      fs.mkdir(pdfViewerFixtureDirectory, { recursive: true }),
      fs.mkdir(path.join(dlcDirectory, "dist"), { recursive: true }),
      fs.mkdir(remoteFixtureDirectory, { recursive: true }),
      fs.mkdir(path.join(remoteDlcDirectory, "dist"), { recursive: true }),
    ]);
    await Promise.all([
      fs.cp(
        path.join(electronDirectory, "../../dist/foundation"),
        path.join(root, "dist/foundation"),
        { recursive: true },
      ),
      fs.cp(
        path.join(electronDirectory, "../../dist/app-runtime"),
        path.join(root, "dist/app-runtime"),
        { recursive: true },
      ),
      fs.cp(
        path.join(electronDirectory, "../../dist/edencss"),
        path.join(root, "dist/edencss"),
        { recursive: true },
      ),
      fs.cp(
        path.join(electronDirectory, "../../dist/app-frame"),
        path.join(root, "dist/app-frame"),
        { recursive: true },
      ),
    ]);
    for (const appName of [
      "files",
      "file-picker",
      "toaster",
      "context-menu",
      "example.hello",
    ]) {
      const source = path.join(
        electronDirectory,
        "../../dist/apps/prebuilt",
        `com.eden.${appName}`,
      );
      const destination = path.join(
        root,
        "dist/apps/prebuilt",
        `com.eden.${appName}`,
      );
      await fs.cp(source, destination, { recursive: true });
    }

    await fs.cp(
      path.join(electronDirectory, "fixtures/app"),
      fixtureDirectory,
      {
        recursive: true,
      },
    );
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
    await fs.cp(
      path.join(
        electronDirectory,
        "../../dist/apps/prebuilt",
        PDF_VIEWER_APP_ID,
      ),
      pdfViewerFixtureDirectory,
      { recursive: true },
    );
    await fs.cp(
      path.join(
        electronDirectory,
        "../../apps/com/eden/pdf-viewer/node_modules/@embedpdf/snippet/dist/demo.pdf",
      ),
      path.join(pdfViewerFixtureDirectory, "dist/demo.pdf"),
    );
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
    await fs.writeFile(
      seedPath,
      JSON.stringify({
        users: [
          {
            username: "integration-vendor",
            name: "Integration Vendor",
            role: "vendor",
            passwordHash: "not-used",
            passwordSalt: "not-used",
          },
        ],
        defaultUsername: "integration-vendor",
      }),
    );

    return {
      root,
      appsDirectory,
      userDirectory,
      seedPath,
      fixtureDirectory,
      pdfViewerFixtureDirectory,
      remoteUrl,
      remoteServer,
    };
  } catch (error) {
    const server = remoteServer;
    if (server?.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    if (root) await fs.rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function disposeElectronProfile(
  profile: ElectronProfile,
): Promise<void> {
  await new Promise<void>((resolve) =>
    profile.remoteServer.close(() => resolve()),
  );
  await fs.rm(profile.root, { recursive: true, force: true });
}
