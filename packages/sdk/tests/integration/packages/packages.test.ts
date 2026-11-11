import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createTestEden, type TestEden } from "../../support/create-test-eden";

describe("Packages development packages", () => {
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
    const packages = eden.runtime.services.packages;
    const catalog = eden.runtime.services.catalog;

    expect(catalog.getPath(manifest.id)).toBe(sourcePath);
    await eden.runtime.effects.run(packages.reloadPackage(manifest.id));
    expect(catalog.getPath(manifest.id)).toBe(sourcePath);
    await eden.runtime.effects.run(packages.reloadPackage(manifest.id));
    expect(catalog.getPath(manifest.id)).toBe(sourcePath);
  });

  it("takes a development app version from package.json", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "eden-dev-package-"));
    const sourcePath = path.join(root, "source");
    const stateDirectory = path.join(root, "state");
    const id = "com.example.inferred-version";
    await fs.mkdir(sourcePath, { recursive: true });
    await fs.mkdir(stateDirectory, { recursive: true });
    await fs.writeFile(
      path.join(sourcePath, "manifest.json"),
      JSON.stringify({
        id,
        name: "Inferred Version App",
        frontend: { entry: "index.html" },
      }),
    );
    await fs.writeFile(
      path.join(sourcePath, "package.json"),
      JSON.stringify({ name: id, version: "2.3.4" }),
    );
    await fs.writeFile(
      path.join(stateDirectory, "apps.json"),
      JSON.stringify({
        protocolVersion: 1,
        apps: [{ id, sourcePath, launchOnStart: false }],
      }),
    );

    eden = await createTestEden({
      root: path.join(root, "runtime"),
      config: {
        development: true,
        hotReload: { enabled: true, stateDirectory },
      },
    });
    const packages = eden.runtime.services.packages;
    const catalog = eden.runtime.services.catalog;

    expect(catalog.get(id)?.version).toBe("2.3.4");
    await fs.writeFile(
      path.join(sourcePath, "package.json"),
      JSON.stringify({ name: id, version: "2.3.5" }),
    );
    await eden.runtime.effects.run(packages.reloadPackage(id));
    expect(catalog.get(id)?.version).toBe("2.3.5");
  });
});
