import "reflect-metadata";

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { RuntimeAppManifest } from "@edenapp/types";
import { AppAssociationManager } from "../app-associations";
import type { AppCatalog } from "../app-registry";
import type { FilesystemManager } from "../filesystem";
import type { I18nManager } from "../i18n/I18nManager";
import type { CommandRegistry, IPCBridge } from "../ipc";
import type { ProcessManager } from "../process-manager";
import type { ViewManager } from "../view-manager";
import { FileOpenManager } from "./FileOpenManager";

const filesApp = {
  id: "com.eden.files",
  name: "Files",
  version: "1.0.0",
  fileHandlers: [{ name: "Directories", directories: true }],
} as RuntimeAppManifest;

const createManager = async () => {
  const userDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "eden-file-"));
  const rootDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "eden-root-"));
  const directoryPath = path.join(rootDirectory, "Documents");
  await fs.mkdir(directoryPath);

  const commandRegistry = {
    registerManager: jest.fn(),
  } as unknown as CommandRegistry;
  const appCatalog = {
    getLaunchable: jest.fn(),
    has: jest.fn((appId: string) => appId === filesApp.id),
    list: jest.fn(() => [filesApp]),
  } as unknown as AppCatalog;
  const appAssociationManager = new AppAssociationManager(
    userDirectory,
    commandRegistry,
    appCatalog,
  );
  await appAssociationManager.initialize();

  const ipcBridge = {
    eventSubscribers: { notifyView: jest.fn() },
  } as unknown as IPCBridge;

  const manager = new FileOpenManager(
    appAssociationManager,
    appCatalog,
    {} as ProcessManager,
    {} as ViewManager,
    { resolvePath: (filePath: string) => filePath } as FilesystemManager,
    { getLocale: jest.fn(async () => "en") } as unknown as I18nManager,
    ipcBridge,
    commandRegistry,
  );

  return { appAssociationManager, directoryPath, manager };
};

describe("FileOpenManager associations", () => {
  it("writes directory defaults through normalized app associations", async () => {
    const { appAssociationManager, directoryPath, manager } =
      await createManager();

    await manager.setDefaultHandler(directoryPath, "com.eden.files");

    expect(appAssociationManager.get("file:directory")).toEqual({
      appId: "com.eden.files",
      kind: "file.directory",
    });
    await expect(manager.getHandlerForPath(directoryPath)).resolves.toBe(
      "com.eden.files",
    );
  });

  it("removes normalized associations for a path", async () => {
    const { appAssociationManager, directoryPath, manager } =
      await createManager();
    await manager.setDefaultHandler(directoryPath, "com.eden.files");

    await manager.removeDefaultHandler(directoryPath);

    expect(appAssociationManager.get("file:directory")).toBeUndefined();
  });

  it("keeps file/get-associations compatibility output", async () => {
    const { directoryPath, manager } = await createManager();
    await manager.setDefaultHandler(directoryPath, "com.eden.files");

    expect(manager.getAllAssociations()).toEqual({
      directory: {
        default: "com.eden.files",
        userOverride: "com.eden.files",
      },
    });
  });
});
