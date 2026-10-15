import * as fs from "node:fs/promises";
import type { Server } from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import {
  APP_ID,
  prepareIntegrationFixture,
  prepareRemoteDlcFixture,
} from "./fixtures";

export interface ElectronProfileOptions {
  apps?: readonly string[];
  fixtures?: readonly ("integration" | "remote-dlc")[];
  additionalAppsDirectory?: string;
}

export interface ElectronProfile {
  root: string;
  appsDirectory: string;
  userDirectory: string;
  seedPath: string;
  fixtureDirectory: string;
  remoteUrl?: string;
  remoteServer?: Server;
}

export async function createElectronProfile(
  options: ElectronProfileOptions = {},
): Promise<ElectronProfile> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eden-electron-"));
  const profile: ElectronProfile = {
    root,
    appsDirectory: path.join(root, "apps"),
    userDirectory: path.join(root, "users"),
    seedPath: path.join(root, "eden-seed.json"),
    fixtureDirectory: path.join(root, "dist/apps/prebuilt", APP_ID),
  };
  try {
    await fs.mkdir(profile.appsDirectory, { recursive: true });
    await fs.mkdir(profile.userDirectory, { recursive: true });
    for (const asset of ["foundation", "app-runtime", "edencss", "app-frame"]) {
      await fs.cp(
        path.join(__dirname, "../../../dist", asset),
        path.join(root, "dist", asset),
        { recursive: true },
      );
    }
    for (const appId of new Set(options.apps)) {
      await fs.cp(
        path.join(__dirname, "../../../dist/apps/prebuilt", appId),
        path.join(root, "dist/apps/prebuilt", appId),
        { recursive: true },
      );
    }
    if (options.additionalAppsDirectory) {
      await fs.cp(
        options.additionalAppsDirectory,
        path.join(root, "dist/apps/prebuilt"),
        { recursive: true },
      );
    }
    for (const fixture of new Set(options.fixtures)) {
      switch (fixture) {
        case "integration":
          await prepareIntegrationFixture(profile);
          break;
        case "remote-dlc":
          await prepareRemoteDlcFixture(profile);
          break;
      }
    }
    await fs.writeFile(
      profile.seedPath,
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
    return profile;
  } catch (error) {
    await disposeElectronProfile(profile);
    throw error;
  }
}

export async function disposeElectronProfile(
  profile: ElectronProfile,
): Promise<void> {
  try {
    const server = profile.remoteServer;
    if (server?.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  } finally {
    await fs.rm(profile.root, { recursive: true, force: true });
  }
}
