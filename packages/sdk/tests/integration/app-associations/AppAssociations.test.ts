import "reflect-metadata";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { UserProfile } from "@edenapp/types";
import { createJsonFileAssociationStorage } from "../../../src/app-associations/json-file";
import { createAppAssociations } from "../../../src/app-associations/service";
import { createEffectRuntime } from "../../../src/effects/runtime";
import { ExecutionContext } from "../../../src/execution/ExecutionContext";
import { PackageCatalog } from "../../../src/package-manager/PackageCatalog";
import { PackageRegistry } from "../../../src/package-manager/PackageRegistry";
import { testApp } from "../../support/apps";

const vendor: UserProfile = {
  username: "vendor",
  name: "Vendor",
  role: "vendor",
  grants: [],
  createdAt: 0,
  updatedAt: 0,
};

describe("app associations persistence and catalog integration", () => {
  const resources: Array<{
    runtime: ReturnType<typeof createEffectRuntime>;
    userDirectory: string;
  }> = [];

  async function createAssociations(content?: string) {
    const userDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "eden-associations-"),
    );
    const runtime = createEffectRuntime();
    resources.push({ runtime, userDirectory });
    const storePath = path.join(userDirectory, "app-associations.json");
    if (content !== undefined) await fs.writeFile(storePath, content);

    const registry = new PackageRegistry();
    const execution = new ExecutionContext({});
    const catalog = new PackageCatalog(
      registry,
      execution,
      userDirectory,
      userDirectory,
    );
    const open = async () => {
      const service = await runtime.acquire(
        createAppAssociations({
          catalog,
          storage: createJsonFileAssociationStorage(userDirectory),
        }),
      );
      await runtime.run(service.initialize());
      return service;
    };
    const associations = await open();

    return {
      associations,
      runtime,
      registry,
      storePath,
      open,
      asVendor: <A>(work: () => A): A =>
        execution.run({ principal: { kind: "user", profile: vendor } }, work),
    };
  }

  afterEach(async () => {
    for (const { runtime, userDirectory } of resources.splice(0)) {
      await runtime.dispose();
      await fs.rm(userDirectory, { recursive: true, force: true });
    }
  });

  it("loads a missing store as empty state", async () => {
    const { associations } = await createAssociations();
    expect(associations.list()).toEqual({});
  });

  it("persists set, get, remove, and list operations across service instances", async () => {
    const { associations, runtime, open } = await createAssociations();
    const selected = {
      appId: "com.eden.editor",
      kind: "file.extension",
      label: "Text files",
    };
    await runtime.run(associations.set("file:ext:txt", selected));

    expect(associations.get("file:ext:txt")).toEqual(selected);
    expect(associations.list({ kindPrefix: "file." })).toEqual({
      "file:ext:txt": selected,
    });
    const reloaded = await open();
    expect(reloaded.get("file:ext:txt")).toEqual(selected);

    await runtime.run(reloaded.remove("file:ext:txt"));
    expect(reloaded.get("file:ext:txt")).toBeUndefined();
    expect((await open()).get("file:ext:txt")).toBeUndefined();
  });

  it("filters association copies by kind prefix", async () => {
    const { associations, runtime } = await createAssociations();
    await runtime.run(
      associations.set("file:directory", {
        appId: "com.eden.files",
        kind: "file.directory",
      }),
    );
    await runtime.run(
      associations.set("provider:file-picker", {
        appId: "com.eden.file-picker",
        kind: "provider",
      }),
    );

    const listed = associations.list({ kindPrefix: "file." });
    expect(listed).toEqual({
      "file:directory": { appId: "com.eden.files", kind: "file.directory" },
    });
    listed["file:directory"].appId = "mutated";
    const selected = associations.get("file:directory")!;
    expect(selected.appId).toBe("com.eden.files");
    selected.appId = "also-mutated";
    expect(associations.get("file:directory")?.appId).toBe("com.eden.files");
  });

  it("resolves a matching configured association before catalog candidates", async () => {
    const { associations, runtime, registry, asVendor } =
      await createAssociations();
    registry.register(testApp("com.example.default"));
    registry.register(testApp("com.example.selected"));
    await runtime.run(
      associations.set("provider:file-picker", {
        appId: "com.example.selected",
        kind: "provider",
      }),
    );

    expect(
      asVendor(() => associations.resolve("provider:file-picker", () => true)),
    ).toEqual([{ appId: "com.example.selected", kind: "provider" }]);
  });

  it("returns matching catalog apps in catalog order when no association exists", async () => {
    const { associations, registry, asVendor } = await createAssociations();
    registry.register(
      testApp("com.example.first", { permissions: ["file-picker/display"] }),
    );
    registry.register(testApp("com.example.other"));
    registry.register(
      testApp("com.example.hidden", {
        hidden: true,
        permissions: ["file-picker/display"],
      }),
    );

    expect(
      asVendor(() =>
        associations.resolve(
          "provider:file-picker",
          (app) => app.permissions?.includes("file-picker/display") === true,
        ),
      ),
    ).toEqual([
      { appId: "com.example.first", kind: "provider" },
      { appId: "com.example.hidden", kind: "provider" },
    ]);
  });

  it("falls back when the configured app disappears or no longer matches", async () => {
    const { associations, runtime, registry, asVendor } =
      await createAssociations();
    registry.register(
      testApp("com.example.default", { permissions: ["file-picker/display"] }),
    );
    registry.register(testApp("com.example.selected"));
    await runtime.run(
      associations.set("provider:file-picker", {
        appId: "com.example.selected",
        kind: "provider",
      }),
    );
    const resolve = () =>
      asVendor(() =>
        associations.resolve(
          "provider:file-picker",
          (app) => app.permissions?.includes("file-picker/display") === true,
        ),
      );

    expect(resolve()).toEqual([
      { appId: "com.example.default", kind: "provider" },
    ]);
    registry.unregister("com.example.selected");
    expect(resolve()).toEqual([
      { appId: "com.example.default", kind: "provider" },
    ]);
  });

  it("ignores invalid stored entries and initializes only once", async () => {
    const { associations, runtime, storePath } = await createAssociations(
      JSON.stringify({
        version: 1,
        associations: {
          valid: { appId: "com.example.valid", kind: "provider" },
          invalid: { appId: "", kind: "provider" },
        },
      }),
    );
    expect(associations.list()).toEqual({
      valid: { appId: "com.example.valid", kind: "provider" },
    });
    await fs.writeFile(
      storePath,
      JSON.stringify({ version: 1, associations: {} }),
    );
    await runtime.run(associations.initialize());
    expect(associations.get("valid")?.appId).toBe("com.example.valid");
  });

  it.each(["{invalid", JSON.stringify({ version: 2, associations: {} })])(
    "treats an unreadable store format as empty: %s",
    async (content) => {
      const { associations } = await createAssociations(content);
      expect(associations.list()).toEqual({});
    },
  );

  it("preserves in-memory mutations when persistence fails", async () => {
    const { associations, runtime, storePath } = await createAssociations();
    await fs.mkdir(storePath);
    await expect(
      runtime.run(
        associations.set("selected", {
          appId: "com.example.selected",
          kind: "provider",
        }),
      ),
    ).rejects.toThrow();
    expect(associations.get("selected")).toEqual({
      appId: "com.example.selected",
      kind: "provider",
    });

    await expect(
      runtime.run(associations.remove("selected")),
    ).rejects.toThrow();
    expect(associations.get("selected")).toBeUndefined();
  });

  it("clears instance state with its owning scope without clearing another service", async () => {
    const first = await createAssociations();
    const second = await createAssociations();
    await first.runtime.run(
      first.associations.set("selected", {
        appId: "com.example.first",
        kind: "provider",
      }),
    );
    await second.runtime.run(
      second.associations.set("selected", {
        appId: "com.example.second",
        kind: "provider",
      }),
    );

    await first.runtime.dispose();
    expect(first.associations.list()).toEqual({});
    expect(second.associations.get("selected")?.appId).toBe(
      "com.example.second",
    );
  });
});
