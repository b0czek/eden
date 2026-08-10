import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createTestEden, type TestEden } from "../testing/createTestEden";
import { PackageCatalog } from "./PackageCatalog";
import { PackageManager } from "./PackageManager";

describe("PackageManager development packages", () => {
  let eden: TestEden;
  let root: string;

  afterEach(async () => {
    await eden?.dispose();
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("preserves the mounted source path across repeated manifest reloads", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "eden-dev-package-"));
    const sourcePath = path.join(root, "source");
    const stateDirectory = path.join(root, "state");
    const manifest = {
      id: "com.example.development",
      name: "Development App",
      version: "1.0.0",
      frontend: { entry: "index.html" },
    };
    await fs.mkdir(sourcePath, { recursive: true });
    await fs.mkdir(stateDirectory, { recursive: true });
    await fs.writeFile(
      path.join(sourcePath, "manifest.json"),
      JSON.stringify(manifest),
    );
    await fs.writeFile(
      path.join(stateDirectory, "apps.json"),
      JSON.stringify({
        protocolVersion: 1,
        apps: [{ id: manifest.id, sourcePath, launchOnStart: false }],
      }),
    );

    eden = await createTestEden({
      root: path.join(root, "runtime"),
      config: {
        development: true,
        hotReload: { enabled: true, stateDirectory },
      },
    });
    const packages = eden.runtime.resolve(PackageManager);
    const catalog = eden.runtime.resolve(PackageCatalog);

    expect(catalog.getPath(manifest.id)).toBe(sourcePath);
    await packages.reloadPackage(manifest.id);
    expect(catalog.getPath(manifest.id)).toBe(sourcePath);
    await packages.reloadPackage(manifest.id);
    expect(catalog.getPath(manifest.id)).toBe(sourcePath);
  });
});
