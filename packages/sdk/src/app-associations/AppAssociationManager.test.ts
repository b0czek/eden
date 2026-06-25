import "reflect-metadata";

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { CommandRegistry } from "../ipc";
import { AppAssociationManager } from "./AppAssociationManager";

const createManager = async () => {
  const userDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "eden-associations-"),
  );
  const commandRegistry = {
    registerManager: jest.fn(),
  } as unknown as CommandRegistry;
  const manager = new AppAssociationManager(userDirectory, commandRegistry);
  await manager.initialize();
  return { manager, userDirectory };
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

    const reloaded = new AppAssociationManager(userDirectory, {
      registerManager: jest.fn(),
    } as unknown as CommandRegistry);
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
});
