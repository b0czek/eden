import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { bundle } from "@edenapp/genesis";
import type {
  AppManifest,
  DlcManifest,
  InstalledPackageInfo,
  UserProfile,
} from "@edenapp/types";
import type { EdenPackageChange } from "../api";
import { PermissionRegistry } from "../ipc";
import { createTestEden, type TestEden } from "../testing/createTestEden";
import { PackageCatalog } from "./PackageCatalog";

const vendor: UserProfile = {
  username: "vendor",
  name: "Vendor",
  role: "vendor",
  grants: [],
  createdAt: 0,
  updatedAt: 0,
};

async function makeArchive(
  root: string,
  outputDirectory: string,
  manifest: AppManifest | DlcManifest,
  files: Record<string, string> = {},
): Promise<string> {
  const source = path.join(root, `source-${manifest.id}-${Math.random()}`);
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(
    path.join(source, "manifest.json"),
    JSON.stringify(manifest),
  );
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(source, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  const output = path.join(
    outputDirectory,
    `${manifest.id}-${manifest.version}.edenite`,
  );
  const result = await bundle({ appDirectory: source, outputPath: output });
  if (!result.success) throw new Error(result.error);
  return `/${path.basename(output)}`;
}

describe("DLC package lifecycle", () => {
  let eden: TestEden;
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "eden-dlc-integration-"));
    eden = await createTestEden({
      root,
      config: { coreApps: ["com.example.host"] },
    });
  });

  afterEach(async () => {
    await eden.dispose();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("installs host-first, scopes access, persists, and cascades removal", async () => {
    const host: AppManifest = {
      id: "com.example.host",
      name: "Host",
      version: "1.0.0",
      frontend: { entry: "index.html" },
      dlc: { extensionPoints: [{ id: "themes", version: "1.2.0" }] },
    };
    const dlc: DlcManifest = {
      kind: "dlc",
      id: "com.example.theme",
      name: "Theme",
      version: "1.0.0",
      hostAppId: host.id,
      contributions: [{ extensionPoint: "themes", requires: "^1.0.0" }],
    };
    const hostArchive = await makeArchive(
      root,
      eden.paths.userDirectory,
      host,
      {
        "index.html": "<html></html>",
      },
    );
    const dlcArchive = await makeArchive(root, eden.paths.userDirectory, dlc, {
      "payload/theme.json": '{"accent":"blue"}',
      "payload/value.mjs": 'export const accent = "blue";',
      "payload/entry.mjs":
        'import { accent } from "./value.mjs"; export default accent;',
    });
    const secondDlc: DlcManifest = {
      ...dlc,
      id: "com.example.theme-contrast",
      name: "Contrast Theme",
    };
    const secondDlcArchive = await makeArchive(
      root,
      eden.paths.userDirectory,
      secondDlc,
      { "payload/theme.json": '{"accent":"yellow"}' },
    );
    await eden.execute(
      "package/install",
      { sourcePath: hostArchive },
      { principal: { kind: "user", profile: vendor } },
    );
    await eden.execute(
      "package/install",
      { sourcePath: dlcArchive },
      { principal: { kind: "user", profile: vendor } },
    );
    await eden.execute(
      "package/install",
      { sourcePath: secondDlcArchive },
      { principal: { kind: "user", profile: vendor } },
    );

    await expect(
      eden.execute<InstalledPackageInfo>(
        "package/self",
        {},
        {
          appId: host.id,
          principal: { kind: "user", profile: vendor },
        },
      ),
    ).resolves.toEqual({
      manifest: expect.objectContaining(host),
      dlcs: [
        {
          manifest: { ...dlc, isPrebuilt: false },
          rootUrl: expect.stringMatching(/^eden-dlc:\/\//),
        },
        {
          manifest: { ...secondDlc, isPrebuilt: false },
          rootUrl: expect.stringMatching(/^eden-dlc:\/\//),
        },
      ],
    });
    const { dlcs: resources } = await eden.execute<InstalledPackageInfo>(
      "package/self",
      {},
      { appId: host.id, principal: { kind: "user", profile: vendor } },
    );
    expect(new URL("payload/entry.mjs", resources[0].rootUrl).href).toMatch(
      /^eden-dlc:\/\/resource\//,
    );

    const inspectorAppId = "com.example.inspector";
    const permissions = eden.runtime.resolve(PermissionRegistry);
    await expect(
      eden.execute(
        "package/get",
        { packageId: host.id },
        {
          appId: inspectorAppId,
          principal: { kind: "user", profile: vendor },
        },
      ),
    ).rejects.toThrow("package/read");
    permissions.registerApp(inspectorAppId, ["package/read"]);
    await expect(
      eden.execute<InstalledPackageInfo>(
        "package/get",
        { packageId: host.id },
        {
          appId: inspectorAppId,
          webContentsId: 40,
          principal: { kind: "user", profile: vendor },
        },
      ),
    ).resolves.toEqual({
      manifest: expect.objectContaining(host),
      dlcs: [
        {
          manifest: { ...dlc, isPrebuilt: false },
          rootUrl: expect.stringMatching(/^eden-dlc:\/\//),
        },
        {
          manifest: { ...secondDlc, isPrebuilt: false },
          rootUrl: expect.stringMatching(/^eden-dlc:\/\//),
        },
      ],
    });
    await expect(
      eden.execute<InstalledPackageInfo>(
        "package/get",
        { packageId: dlc.id },
        {
          appId: inspectorAppId,
          principal: { kind: "user", profile: vendor },
        },
      ),
    ).resolves.toEqual({
      manifest: { ...dlc, isPrebuilt: false },
      dlcs: [],
    });
    await expect(
      eden.execute<{ size?: number }>(
        "package/get-size",
        { packageId: dlc.id },
        { principal: { kind: "user", profile: vendor } },
      ),
    ).resolves.toEqual({ size: expect.any(Number) });

    const { dlcs: rendererResources } =
      await eden.execute<InstalledPackageInfo>(
        "package/self",
        {},
        {
          appId: host.id,
          webContentsId: 41,
          principal: { kind: "user", profile: vendor },
        },
      );
    const moduleUrl = new URL("payload/entry.mjs", rendererResources[0].rootUrl)
      .href;
    await expect(
      eden.platform.requestResource("eden-dlc", {
        url: moduleUrl,
        method: "GET",
        webContentsId: 42,
      }),
    ).resolves.toEqual({ status: 403 });
    await expect(
      eden.platform.requestResource("eden-dlc", {
        url: `${rendererResources[0].rootUrl}%2e%2e%2fmanifest.json`,
        method: "GET",
        webContentsId: 41,
      }),
    ).resolves.toEqual({ status: 403 });
    await expect(
      eden.platform.requestResource("eden-dlc", {
        url: moduleUrl,
        method: "GET",
        webContentsId: 41,
      }),
    ).resolves.toMatchObject({
      status: 200,
      filePath: expect.stringMatching(/payload[/\\]entry\.mjs$/),
    });
    await expect(
      eden.platform.requestResource("eden-dlc", {
        url: moduleUrl,
        method: "POST",
        webContentsId: 41,
      }),
    ).resolves.toEqual({ status: 403 });

    await eden.dispose();
    eden = await createTestEden({ root, config: { coreApps: [host.id] } });
    expect(eden.runtime.packages.list({ kind: "dlc" })).toEqual([
      { ...dlc, isPrebuilt: false },
      { ...secondDlc, isPrebuilt: false },
    ]);
    const changes: EdenPackageChange[] = [];
    const unsubscribe = eden.runtime.packages.onChanged((change) =>
      changes.push(change),
    );
    await eden.runtime.packages.uninstall(host.id);
    unsubscribe();
    expect(eden.runtime.packages.list({ kind: "dlc" })).toEqual([]);
    expect(changes).toEqual([
      {
        type: "uninstalled",
        kind: "dlc",
        packageId: dlc.id,
        hostAppId: host.id,
      },
      {
        type: "uninstalled",
        kind: "dlc",
        packageId: secondDlc.id,
        hostAppId: host.id,
      },
      { type: "uninstalled", kind: "app", packageId: host.id },
    ]);
  }, 30_000);

  it("rejects missing or incompatible hosts and mutations while the host runs", async () => {
    const missing: DlcManifest = {
      kind: "dlc",
      id: "com.example.missing-theme",
      name: "Missing Theme",
      version: "1.0.0",
      hostAppId: "com.example.missing",
      contributions: [{ extensionPoint: "themes", requires: "^1.0.0" }],
    };
    const missingArchive = await makeArchive(
      root,
      eden.paths.userDirectory,
      missing,
    );
    await expect(
      eden.execute(
        "package/install",
        { sourcePath: missingArchive },
        { principal: { kind: "user", profile: vendor } },
      ),
    ).rejects.toThrow("is not installed");

    const host: AppManifest = {
      id: "com.example.host",
      name: "Host",
      version: "1.0.0",
      frontend: { entry: "index.html" },
      dlc: { extensionPoints: [{ id: "themes", version: "2.0.0" }] },
    };
    const hostArchive = await makeArchive(
      root,
      eden.paths.userDirectory,
      host,
      {
        "index.html": "<html></html>",
      },
    );
    await eden.execute(
      "package/install",
      { sourcePath: hostArchive },
      { principal: { kind: "user", profile: vendor } },
    );
    const incompatible = {
      ...missing,
      id: "com.example.old-theme",
      hostAppId: host.id,
    };
    const incompatibleArchive = await makeArchive(
      root,
      eden.paths.userDirectory,
      incompatible,
    );
    await expect(
      eden.execute(
        "package/install",
        { sourcePath: incompatibleArchive },
        { principal: { kind: "user", profile: vendor } },
      ),
    ).rejects.toThrow("incompatible");

    const unknownPoint: DlcManifest = {
      ...missing,
      id: "com.example.unknown-point",
      hostAppId: host.id,
      contributions: [
        { extensionPoint: "language-highlighters", requires: "^2.0.0" },
      ],
    };
    const unknownPointArchive = await makeArchive(
      root,
      eden.paths.userDirectory,
      unknownPoint,
    );
    await expect(
      eden.execute(
        "package/install",
        { sourcePath: unknownPointArchive },
        { principal: { kind: "user", profile: vendor } },
      ),
    ).rejects.toThrow("does not declare extension point");

    const compatible: DlcManifest = {
      ...missing,
      id: "com.example.current-theme",
      hostAppId: host.id,
      contributions: [{ extensionPoint: "themes", requires: "^2.0.0" }],
    };
    const compatibleArchive = await makeArchive(
      root,
      eden.paths.userDirectory,
      compatible,
    );
    await eden.execute(
      "package/install",
      { sourcePath: compatibleArchive },
      { principal: { kind: "user", profile: vendor } },
    );
    await expect(
      eden.runtime.packages.isHotReloadEnabled(compatible.id),
    ).rejects.toThrow("is not an installed app");
    await expect(
      eden.runtime.packages.toggleHotReload(compatible.id),
    ).rejects.toThrow("is not an installed app");

    await eden.runtime.users.create({
      username: "runner",
      name: "Runner",
      role: "standard",
      password: "password",
    });
    await eden.runtime.sessions.login("runner", "password");
    await eden.execute("process/launch", { appId: host.id });
    await expect(
      eden.execute("package/uninstall", { packageId: host.id }),
    ).rejects.toThrow("must be stopped");
    await expect(
      eden.execute("package/uninstall", { packageId: compatible.id }),
    ).rejects.toThrow("must be stopped");
    await expect(
      eden.execute(
        "package/install",
        { sourcePath: compatibleArchive, replace: true },
        { principal: { kind: "user", profile: vendor } },
      ),
    ).rejects.toThrow("must be stopped");
  }, 30_000);

  it("requires replacement confirmation and removes incompatible DLCs atomically", async () => {
    const hostV1: AppManifest = {
      id: "com.example.host",
      name: "Host",
      version: "1.0.0",
      frontend: { entry: "index.html" },
      dlc: { extensionPoints: [{ id: "themes", version: "1.0.0" }] },
    };
    const dlc: DlcManifest = {
      kind: "dlc",
      id: "com.example.v1-theme",
      name: "V1 Theme",
      version: "1.0.0",
      hostAppId: hostV1.id,
      contributions: [{ extensionPoint: "themes", requires: "^1.0.0" }],
    };
    const hostV2: AppManifest = {
      ...hostV1,
      version: "2.0.0",
      dlc: { extensionPoints: [{ id: "themes", version: "2.0.0" }] },
    };
    const [hostV1Archive, hostV2Archive, dlcArchive] = await Promise.all([
      makeArchive(root, eden.paths.userDirectory, hostV1, {
        "index.html": "v1",
      }),
      makeArchive(root, eden.paths.userDirectory, hostV2, {
        "index.html": "v2",
      }),
      makeArchive(root, eden.paths.userDirectory, dlc),
    ]);
    const caller = { principal: { kind: "user" as const, profile: vendor } };
    await eden.execute(
      "package/install",
      { sourcePath: hostV1Archive },
      caller,
    );
    await eden.execute("package/install", { sourcePath: dlcArchive }, caller);

    await expect(
      eden.execute("package/install", { sourcePath: hostV2Archive }, caller),
    ).rejects.toThrow("confirmation is required");
    expect(eden.runtime.packages.get(hostV1.id)?.manifest.version).toBe(
      "1.0.0",
    );
    expect(eden.runtime.packages.get(dlc.id)).toEqual({
      manifest: { ...dlc, isPrebuilt: false },
      dlcs: [],
    });

    await eden.execute(
      "package/install",
      { sourcePath: hostV2Archive, replace: true },
      caller,
    );
    expect(eden.runtime.packages.get(hostV1.id)?.manifest.version).toBe(
      "2.0.0",
    );
    expect(eden.runtime.packages.get(dlc.id)).toBeUndefined();

    await expect(
      eden.execute("package/install", { sourcePath: hostV2Archive }, caller),
    ).rejects.toThrow("reinstall confirmation");
    await eden.execute(
      "package/install",
      { sourcePath: hostV2Archive, replace: true },
      caller,
    );
    await eden.execute(
      "package/install",
      { sourcePath: hostV1Archive, replace: true },
      caller,
    );
    expect(eden.runtime.packages.get(hostV1.id)?.manifest.version).toBe(
      "1.0.0",
    );
  }, 30_000);

  it("loads and protects built-in DLCs from the prebuilt package directory", async () => {
    await eden.dispose();
    eden = await createTestEden({
      root,
      autoStart: false,
      config: { coreApps: ["com.example.builtin-host"] },
    });
    const host: AppManifest = {
      id: "com.example.builtin-host",
      name: "Built-in Host",
      version: "1.0.0",
      frontend: { entry: "index.html" },
      icon: "icon.svg",
      dlc: { extensionPoints: [{ id: "themes", version: "1.0.0" }] },
    };
    const dlc: DlcManifest = {
      kind: "dlc",
      id: "com.example.builtin-theme",
      name: "Built-in Theme",
      version: "1.0.0",
      icon: "icon.svg",
      hostAppId: host.id,
      contributions: [{ extensionPoint: "themes", requires: "^1.0.0" }],
    };
    const prebuiltRoot = path.join(eden.paths.distPath, "apps", "prebuilt");
    const hostRoot = path.join(prebuiltRoot, host.id);
    const dlcRoot = path.join(prebuiltRoot, dlc.id);
    const installedHostRoot = path.join(eden.paths.appsDirectory, host.id);
    const installedDlcRoot = path.join(
      eden.paths.appsDirectory,
      ".dlcs",
      dlc.id,
    );
    await Promise.all([
      fs.mkdir(hostRoot, { recursive: true }),
      fs.mkdir(path.join(dlcRoot, "payload"), { recursive: true }),
      fs.mkdir(installedHostRoot, { recursive: true }),
      fs.mkdir(installedDlcRoot, { recursive: true }),
    ]);
    await Promise.all([
      fs.writeFile(path.join(hostRoot, "manifest.json"), JSON.stringify(host)),
      fs.writeFile(path.join(hostRoot, "index.html"), "<html></html>"),
      fs.writeFile(path.join(hostRoot, "icon.svg"), "<svg></svg>"),
      fs.writeFile(path.join(dlcRoot, "manifest.json"), JSON.stringify(dlc)),
      fs.writeFile(path.join(dlcRoot, "icon.svg"), "<svg></svg>"),
      fs.writeFile(
        path.join(dlcRoot, "payload/theme.json"),
        '{"builtIn":true}',
      ),
      fs.writeFile(
        path.join(installedHostRoot, "manifest.json"),
        JSON.stringify({ ...host, version: "9.0.0" }),
      ),
      fs.writeFile(
        path.join(installedDlcRoot, "manifest.json"),
        JSON.stringify({ ...dlc, version: "9.0.0" }),
      ),
    ]);

    await eden.start();
    const replacementArchive = await makeArchive(
      root,
      eden.paths.userDirectory,
      { ...dlc, version: "2.0.0" },
      { "payload/theme.json": '{"builtIn":false}' },
    );

    expect(eden.runtime.packages.get(host.id)?.manifest).toMatchObject({
      id: host.id,
      version: "1.0.0",
      isPrebuilt: true,
    });
    expect(eden.runtime.packages.get(dlc.id)).toEqual({
      manifest: { ...dlc, isPrebuilt: true },
      dlcs: [],
    });
    expect(eden.runtime.resolve(PackageCatalog).getPath(dlc.id)).toBe(dlcRoot);
    await expect(
      eden.runtime.packages.getSize(dlc.id),
    ).resolves.toBeGreaterThan(0);
    await expect(eden.runtime.packages.getIcon(dlc.id)).resolves.toMatch(
      /^data:image\/svg\+xml;base64,/,
    );
    await expect(
      eden.execute<InstalledPackageInfo>(
        "package/self",
        {},
        {
          appId: host.id,
          principal: { kind: "user", profile: vendor },
        },
      ),
    ).resolves.toMatchObject({
      manifest: { id: host.id, isPrebuilt: true },
      dlcs: [
        {
          manifest: { id: dlc.id, isPrebuilt: true },
          rootUrl: expect.stringMatching(/^eden-dlc:\/\//),
        },
      ],
    });
    await expect(
      eden.execute(
        "package/install",
        { sourcePath: replacementArchive, replace: true },
        { principal: { kind: "user", profile: vendor } },
      ),
    ).rejects.toThrow("bundled DLC");
    await expect(
      eden.execute(
        "package/uninstall",
        { packageId: dlc.id },
        { principal: { kind: "user", profile: vendor } },
      ),
    ).rejects.toThrow("bundled DLC");
    await expect(
      eden.execute(
        "package/uninstall",
        { packageId: host.id },
        { principal: { kind: "user", profile: vendor } },
      ),
    ).rejects.toThrow("system app");
  });
});
