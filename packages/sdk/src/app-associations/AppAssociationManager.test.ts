import "reflect-metadata";

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { RuntimeAppManifest } from "@edenapp/types";
import type { AppCatalog } from "../app-registry";
import type { CommandRegistry } from "../ipc";
import { AppAssociationManager } from "./AppAssociationManager";

const manifest = (id: string): RuntimeAppManifest =>
  ({
    id,
    name: id,
    version: "1.0.0",
    isPrebuilt: false,
    isDevelopment: false,
    isCore: false,
    isRestricted: false,
    resolvedGrants: [],
  }) as RuntimeAppManifest;

const createManager = async () => {
  const userDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "eden-associations-"),
  );
  const commandRegistry = {
    registerManager: jest.fn(),
  } as unknown as CommandRegistry;
  const appCatalog = {
    getLaunchable: jest.fn(),
    list: jest.fn(() => []),
  } as unknown as jest.Mocked<Pick<AppCatalog, "getLaunchable" | "list">>;
  const manager = new AppAssociationManager(
    userDirectory,
    commandRegistry,
    appCatalog as unknown as AppCatalog,
  );
  await manager.initialize();
  return { appCatalog, manager, userDirectory };
};

describe("AppAssociationManager", () => {
  it("loads a missing store as an empty v1 state", async () => {
    const { manager } = await createManager();

    expect(manager.list()).toEqual({});
  });

  it("persists set, get, remove, and list operations", async () => {
    const { manager, userDirectory } = await createManager();

    await manager.set("file:ext:txt", {
      appId: "com.eden.editor",
      kind: "file.extension",
      label: "Text files",
    });

    expect(manager.get("file:ext:txt")).toEqual({
      appId: "com.eden.editor",
      kind: "file.extension",
      label: "Text files",
    });
    expect(manager.list({ kindPrefix: "file." })).toEqual({
      "file:ext:txt": {
        appId: "com.eden.editor",
        kind: "file.extension",
        label: "Text files",
      },
    });

    const reloaded = new AppAssociationManager(
      userDirectory,
      {
        registerManager: jest.fn(),
      } as unknown as CommandRegistry,
      {
        getLaunchable: jest.fn(),
        list: jest.fn(() => []),
      } as unknown as AppCatalog,
    );
    await reloaded.initialize();
    expect(reloaded.get("file:ext:txt")).toEqual({
      appId: "com.eden.editor",
      kind: "file.extension",
      label: "Text files",
    });

    await reloaded.remove("file:ext:txt");
    expect(reloaded.get("file:ext:txt")).toBeUndefined();
  });

  it("filters associations by kind prefix", async () => {
    const { manager } = await createManager();

    await manager.set("file:directory", {
      appId: "com.eden.files",
      kind: "file.directory",
    });
    await manager.set("provider:file-picker", {
      appId: "com.eden.file-picker",
      kind: "provider",
    });

    expect(manager.list({ kindPrefix: "file." })).toEqual({
      "file:directory": {
        appId: "com.eden.files",
        kind: "file.directory",
      },
    });
  });

  it("resolves a valid configured association before candidates", async () => {
    const { appCatalog, manager } = await createManager();
    await manager.set("provider:file-picker", {
      appId: "com.example.selected",
      kind: "provider",
    });
    const selected = manifest("com.example.selected");
    appCatalog.getLaunchable.mockReturnValue(selected);
    const matches = jest.fn(() => true);

    expect(manager.resolve("provider:file-picker", matches)).toEqual([
      { appId: "com.example.selected", kind: "provider" },
    ]);
    expect(matches).toHaveBeenCalledWith(selected);
    expect(appCatalog.list).not.toHaveBeenCalled();
  });

  it("returns matching catalog apps when no configured association exists", async () => {
    const { appCatalog, manager } = await createManager();
    const defaultApp = manifest("com.example.default");
    const otherApp = manifest("com.example.other");
    appCatalog.list.mockReturnValue([defaultApp, otherApp]);
    const matches = jest.fn((app) => app === defaultApp);

    expect(manager.resolve("provider:file-picker", matches)).toEqual([
      { appId: "com.example.default", kind: "provider" },
    ]);
    expect(appCatalog.list).toHaveBeenCalledWith({ showHidden: true });
  });

  it("falls back when the configured association is invalid", async () => {
    const { appCatalog, manager } = await createManager();
    await manager.set("provider:file-picker", {
      appId: "com.example.missing",
      kind: "provider",
    });
    const defaultApp = manifest("com.example.default");
    appCatalog.getLaunchable.mockReturnValue(undefined);
    appCatalog.list.mockReturnValue([defaultApp]);

    expect(manager.resolve("provider:file-picker", () => true)).toEqual([
      { appId: "com.example.default", kind: "provider" },
    ]);
  });
});
