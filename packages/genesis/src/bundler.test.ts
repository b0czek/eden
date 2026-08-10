import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { AppManifest, DlcManifest } from "@edenapp/types";
import * as tar from "tar";
import * as bundler from "./bundler";
import { ZstdCodecCompressor } from "./compression";

async function rewriteArchiveMetadata(
  archive: string,
  update: (metadata: Record<string, unknown>) => void,
): Promise<void> {
  const content = await fs.readFile(archive);
  const length = content.readUInt32BE(0);
  const metadata = JSON.parse(
    content.subarray(4, 4 + length).toString("utf-8"),
  );
  update(metadata);
  const next = Buffer.from(JSON.stringify(metadata), "utf-8");
  if (next.length !== length) throw new Error("Test metadata length changed");
  next.copy(content, 4);
  await fs.writeFile(archive, content);
}

async function createArchiveWithLink(
  directory: string,
  archive: string,
  manifest: AppManifest,
): Promise<void> {
  const tarPath = path.join(directory, "hostile.tar");
  const compressedPath = `${tarPath}.zst`;
  await fs.writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify(manifest),
  );
  await fs.symlink("/tmp", path.join(directory, "escaping-link"));
  await tar.create({ cwd: directory, file: tarPath, portable: true }, [
    "manifest.json",
    "escaping-link",
  ]);
  const compressor = new ZstdCodecCompressor();
  await compressor.initialize();
  const { checksum } = await compressor.compressFileStreaming(
    tarPath,
    compressedPath,
    1,
  );
  const metadata = Buffer.from(
    JSON.stringify({
      version: 1,
      checksum,
      created: new Date(0).toISOString(),
      manifest,
    }),
  );
  const length = Buffer.alloc(4);
  length.writeUInt32BE(metadata.length);
  await fs.writeFile(
    archive,
    Buffer.concat([length, metadata, await fs.readFile(compressedPath)]),
  );
}

describe("bundler module", () => {
  // Use absolute path from project root
  const projectRoot = path.resolve(__dirname, "..");
  const sampleAppPath = path.join(projectRoot, "examples/sample-app");
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for test outputs
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-test-"));
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (_) {
      // Ignore cleanup errors
    }
  });

  describe("validateManifest", () => {
    it("should validate a correct manifest object", async () => {
      const manifestPath = path.join(sampleAppPath, "manifest.json");
      const manifest = JSON.parse(
        await fs.readFile(manifestPath, "utf-8"),
      ) as AppManifest;
      const result = bundler.validateManifestObject(manifest);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.manifest?.id).toBe("com.example.hello");
    });

    it("should validate a correct manifest", async () => {
      const manifestPath = path.join(sampleAppPath, "manifest.json");
      const result = await bundler.validateManifest(manifestPath);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.manifest).toBeDefined();
      expect(result.manifest?.id).toBe("com.example.hello");
      expect(result.manifest?.name).toBe("Hello Eden");
      expect(result.manifest?.version).toBe("1.0.0");
    });

    it("should reject an invalid manifest", async () => {
      const invalidManifestPath = path.join(tempDir, "invalid-manifest.json");
      await fs.writeFile(
        invalidManifestPath,
        JSON.stringify({ name: "Test" }), // Missing required fields
      );

      const result = await bundler.validateManifest(invalidManifestPath);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("infers a missing app version from package.json", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      await fs.writeFile(
        manifestPath,
        JSON.stringify({
          id: "com.example.inferred-version",
          name: "Inferred Version",
          frontend: { entry: "index.html" },
        }),
      );
      await fs.writeFile(
        path.join(tempDir, "package.json"),
        JSON.stringify({ version: "2.3.4" }),
      );

      const result = await bundler.validateManifest(manifestPath);

      expect(result).toMatchObject({
        valid: true,
        errors: [],
        manifest: { version: "2.3.4" },
      });
    });

    it("keeps an explicit manifest version without reading package.json", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      await fs.writeFile(
        manifestPath,
        JSON.stringify({
          id: "com.example.explicit-version",
          name: "Explicit Version",
          version: "3.0.0",
          frontend: { entry: "index.html" },
        }),
      );
      await fs.writeFile(path.join(tempDir, "package.json"), "not json");

      const result = await bundler.validateManifest(manifestPath);

      expect(result.valid).toBe(true);
      expect(result.manifest?.version).toBe("3.0.0");
    });

    it("explains when a missing app version cannot be inferred", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      await fs.writeFile(
        manifestPath,
        JSON.stringify({
          id: "com.example.missing-version",
          name: "Missing Version",
          frontend: { entry: "index.html" },
        }),
      );

      const result = await bundler.validateManifest(manifestPath);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain(
        "Could not infer app version from package.json",
      );
    });

    it("rejects a package.json without a usable version", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      await fs.writeFile(
        manifestPath,
        JSON.stringify({
          id: "com.example.invalid-package-version",
          name: "Invalid Package Version",
          frontend: { entry: "index.html" },
        }),
      );
      await fs.writeFile(
        path.join(tempDir, "package.json"),
        JSON.stringify({ version: "" }),
      );

      const result = await bundler.validateManifest(manifestPath);

      expect(result).toEqual({
        valid: false,
        errors: [
          "Could not infer app version from package.json: version must be a non-empty string",
        ],
      });
    });

    it("validates the build concurrency hint", () => {
      const manifest: AppManifest = {
        id: "com.example.build",
        name: "Build",
        version: "1.0.0",
        frontend: { entry: "dist/index.html" },
        build: { command: "npm run build", concurrent: false },
      };

      expect(bundler.validateManifestObject(manifest).valid).toBe(true);

      if (!manifest.build) {
        throw new Error("Expected test manifest to include build settings");
      }
      manifest.build.concurrent = "no" as unknown as boolean;
      expect(bundler.validateManifestObject(manifest)).toMatchObject({
        valid: false,
        errors: ["build.concurrent must be a boolean"],
      });
    });

    it("validates shared setting readers", () => {
      const baseManifest: AppManifest = {
        id: "com.example.owner",
        name: "Owner",
        version: "1.0.0",
        frontend: { entry: "dist/index.html" },
        settings: [
          {
            id: "behavior",
            name: "Behavior",
            settings: [
              {
                key: "singleClick",
                label: "Single click",
                type: "toggle",
                sharedWith: ["com.example.reader"],
              },
            ],
          },
        ],
      };

      expect(bundler.validateManifestObject(baseManifest).valid).toBe(true);

      const invalidReaders = [
        ["com.example.owner"],
        ["com.example.reader", "com.example.reader"],
        ["*"],
        ["Invalid App"],
        "com.example.reader",
      ];

      for (const sharedWith of invalidReaders) {
        const manifest = structuredClone(baseManifest);
        const setting = manifest.settings?.[0]?.settings[0];
        if (!setting) {
          throw new Error("Expected test setting");
        }
        setting.sharedWith = sharedWith as unknown as string[];
        expect(bundler.validateManifestObject(manifest).valid).toBe(false);
      }
    });

    it("accepts legacy apps and valid DLC manifests", () => {
      const legacy: AppManifest = {
        id: "com.example.host",
        name: "Host",
        version: "not-strict-semver",
        frontend: { entry: "index.html" },
        dlc: { extensionPoints: [{ id: "themes", version: "2.1.0" }] },
      };
      const dlc: DlcManifest = {
        kind: "dlc",
        id: "com.example.theme",
        name: "Theme",
        version: "release-4",
        hostAppId: legacy.id,
        fileHandlers: [
          {
            name: "Theme source",
            extensions: ["theme-source"],
          },
        ],
        contributions: [
          {
            extensionPoint: "themes",
            requires: "^2.0.0",
            metadata: { palette: ["blue", "green"] },
          },
        ],
      };

      expect(bundler.validatePackageManifestObject(legacy).valid).toBe(true);
      expect(bundler.validatePackageManifestObject(dlc).valid).toBe(true);
      expect(bundler.isDlcCompatible(legacy, dlc).compatible).toBe(true);
    });

    it("rejects malformed DLC file handlers", () => {
      const base = {
        kind: "dlc",
        id: "com.example.theme",
        name: "Theme",
        version: "1.0.0",
        hostAppId: "com.example.host",
        contributions: [{ extensionPoint: "themes", requires: "^1.0.0" }],
      } as const;

      expect(
        bundler.validatePackageManifestObject({
          ...base,
          fileHandlers: [{ name: "Empty" }],
        }).errors,
      ).toContain(
        "fileHandlers[0] must declare extensions, mimeTypes, or directories",
      );
      expect(
        bundler.validatePackageManifestObject({
          ...base,
          fileHandlers: "http",
        }).errors,
      ).toContain("fileHandlers must be an array");
    });

    it("rejects malformed kinds and invalid DLC contracts", () => {
      expect(
        bundler.validatePackageManifestObject({
          kind: "plugin",
          id: "com.example.bad",
        }).errors,
      ).toContain('Manifest kind must be "app", "dlc", or omitted');

      const invalid = bundler.validatePackageManifestObject({
        kind: "dlc",
        id: "com.example.bad-dlc",
        name: "Bad DLC",
        version: "1",
        hostAppId: "",
        contributions: [
          { extensionPoint: "themes", requires: "not a semver range" },
        ],
        permissions: ["*"],
      });
      expect(invalid.valid).toBe(false);
      expect(invalid.errors.join(" ")).toContain("hostAppId");
      expect(invalid.errors.join(" ")).toContain("valid SemVer range");
      expect(invalid.errors.join(" ")).toContain("cannot declare permissions");
    });
  });

  describe("verifyFiles", () => {
    it("should verify files exist for sample app", async () => {
      const manifestPath = path.join(sampleAppPath, "manifest.json");
      const validation = await bundler.validateManifest(manifestPath);

      expect(validation.valid).toBe(true);
      if (!validation.manifest) {
        throw new Error("Expected manifest after valid validation");
      }

      const result = await bundler.verifyFiles(
        sampleAppPath,
        validation.manifest,
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("bundle", () => {
    it("bundles and extracts a DLC package", async () => {
      const source = path.join(tempDir, "dlc-source");
      const archive = path.join(tempDir, "theme.edenite");
      const extracted = path.join(tempDir, "dlc-extracted");
      const manifest: DlcManifest = {
        kind: "dlc",
        id: "com.example.theme",
        name: "Theme",
        version: "1.0.0",
        hostAppId: "com.example.host",
        contributions: [{ extensionPoint: "themes", requires: "^1.0.0" }],
      };
      await fs.mkdir(path.join(source, "payload"), { recursive: true });
      await fs.writeFile(
        path.join(source, "manifest.json"),
        JSON.stringify(manifest),
      );
      await fs.writeFile(path.join(source, "payload", "theme.json"), "{}");

      const bundled = await bundler.bundle({
        appDirectory: source,
        outputPath: archive,
      });
      expect(bundled).toMatchObject({ success: true, manifest });
      const result = await bundler.extract({
        edenitePath: archive,
        outputDirectory: extracted,
      });
      expect(result).toMatchObject({ success: true, manifest });
      await expect(
        fs.readFile(path.join(extracted, "payload", "theme.json"), "utf-8"),
      ).resolves.toBe("{}");
    });
    it("should bundle the sample app successfully", async () => {
      const outputPath = path.join(tempDir, "test-app.edenite");

      const result = await bundler.bundle({
        appDirectory: sampleAppPath,
        outputPath,
        verbose: false,
      });

      expect(result.success).toBe(true);
      expect(result.outputPath).toBe(outputPath);
      expect(result.manifest?.id).toBe("com.example.hello");
      expect(result.checksum).toBeDefined();
      expect(result.size).toBeGreaterThan(0);

      // Verify the file was created
      const stat = await fs.stat(outputPath);
      expect(stat.isFile()).toBe(true);
    }, 30000); // Increase timeout for compression

    it("should support dry-run mode", async () => {
      const outputPath = path.join(tempDir, "test-app-dry.edenite");

      const result = await bundler.bundle({
        appDirectory: sampleAppPath,
        outputPath,
        verbose: false,
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.manifest?.id).toBe("com.example.hello");

      // Verify no file was created
      await expect(fs.access(outputPath)).rejects.toThrow();
    });

    it("should respect compression level", async () => {
      const outputPath1 = path.join(tempDir, "test-level-1.edenite");
      const outputPath22 = path.join(tempDir, "test-level-22.edenite");

      const result1 = await bundler.bundle({
        appDirectory: sampleAppPath,
        outputPath: outputPath1,
        compressionLevel: 1,
        verbose: false,
      });

      const result22 = await bundler.bundle({
        appDirectory: sampleAppPath,
        outputPath: outputPath22,
        compressionLevel: 22,
        verbose: false,
      });

      expect(result1.success).toBe(true);
      expect(result22.success).toBe(true);

      // Level 22 should produce smaller file
      const size1 = (await fs.stat(outputPath1)).size;
      const size22 = (await fs.stat(outputPath22)).size;
      expect(size22).toBeLessThan(size1);
    }, 30000);

    it("should bundle files specified in include directive", async () => {
      // 1. Setup temp app directory
      const tempAppPath = path.join(tempDir, "app-with-include");
      await fs.cp(sampleAppPath, tempAppPath, { recursive: true });

      // 2. Add an extra file to include
      const extraFilePath = path.join(tempAppPath, "extra-data.txt");
      await fs.writeFile(extraFilePath, "This file should be included");

      // 3. Update manifest to include it
      const manifestPath = path.join(tempAppPath, "manifest.json");
      const manifestContent = JSON.parse(
        await fs.readFile(manifestPath, "utf-8"),
      );
      manifestContent.include = ["extra-data.txt"];
      await fs.writeFile(manifestPath, JSON.stringify(manifestContent));

      // 4. Bundle
      const outputPath = path.join(tempDir, "include-test.edenite");
      const result = await bundler.bundle({
        appDirectory: tempAppPath,
        outputPath,
        verbose: false,
      });

      expect(result.success).toBe(true);

      // 5. Extract and verify
      const extractPath = path.join(tempDir, "extracted-include");
      await bundler.extract({
        edenitePath: outputPath,
        outputDirectory: extractPath,
        verbose: false,
      });

      const extractedExtraFile = path.join(extractPath, "extra-data.txt");
      const exists = await fs
        .access(extractedExtraFile)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
      const content = await fs.readFile(extractedExtraFile, "utf-8");
      expect(content).toBe("This file should be included");
    });
  });

  describe("getInfo", () => {
    it("should read info from bundled archive", async () => {
      const outputPath = path.join(tempDir, "test-info.edenite");

      // First bundle the app
      const bundleResult = await bundler.bundle({
        appDirectory: sampleAppPath,
        outputPath,
        verbose: false,
      });

      expect(bundleResult.success).toBe(true);

      // Now read the info
      const infoResult = await bundler.getInfo(outputPath);

      expect(infoResult.success).toBe(true);
      expect(infoResult.manifest?.id).toBe("com.example.hello");
      expect(infoResult.manifest?.name).toBe("Hello Eden");
      expect(infoResult.checksum).toBe(bundleResult.checksum);
    }, 30000);

    it("rejects unsupported archive versions", async () => {
      const outputPath = path.join(tempDir, "future.edenite");
      await bundler.bundle({ appDirectory: sampleAppPath, outputPath });
      await rewriteArchiveMetadata(outputPath, (metadata) => {
        metadata.version = 2;
      });
      await expect(bundler.getInfo(outputPath)).resolves.toMatchObject({
        success: false,
        error: expect.stringContaining("Unsupported .edenite archive version"),
      });
    });
  });

  describe("extract", () => {
    it("should extract bundled archive", async () => {
      const bundlePath = path.join(tempDir, "test-extract.edenite");
      const extractPath = path.join(tempDir, "extracted");

      // First bundle the app
      const bundleResult = await bundler.bundle({
        appDirectory: sampleAppPath,
        outputPath: bundlePath,
        verbose: false,
      });

      expect(bundleResult.success).toBe(true);

      // Now extract it
      const extractResult = await bundler.extract({
        edenitePath: bundlePath,
        outputDirectory: extractPath,
        verbose: false,
        verifyChecksum: true,
      });

      expect(extractResult.success).toBe(true);
      expect(extractResult.manifest?.id).toBe("com.example.hello");

      // Verify files were extracted
      const manifestExists = await fs
        .access(path.join(extractPath, "manifest.json"))
        .then(() => true)
        .catch(() => false);
      expect(manifestExists).toBe(true);

      const indexExists = await fs
        .access(path.join(extractPath, "index.html"))
        .then(() => true)
        .catch(() => false);
      expect(indexExists).toBe(true);
    }, 30000);

    it("should detect corrupted archive via checksum", async () => {
      const bundlePath = path.join(tempDir, "test-corrupt.edenite");
      const extractPath = path.join(tempDir, "extracted-corrupt");

      // First bundle the app
      await bundler.bundle({
        appDirectory: sampleAppPath,
        outputPath: bundlePath,
        verbose: false,
      });

      // Corrupt the file by modifying a byte
      const data = await fs.readFile(bundlePath);
      const corruptedData = Buffer.from(data);
      corruptedData[data.length - 10] = corruptedData[data.length - 10] ^ 0xff;
      await fs.writeFile(bundlePath, corruptedData);

      // Try to extract with checksum verification
      const extractResult = await bundler.extract({
        edenitePath: bundlePath,
        outputDirectory: extractPath,
        verbose: false,
        verifyChecksum: true,
      });

      expect(extractResult.success).toBe(false);
      expect(extractResult.error).toContain("Checksum mismatch");
    }, 30000);

    it("rejects disagreement between archive metadata and extracted manifest", async () => {
      const bundlePath = path.join(tempDir, "mismatch.edenite");
      await bundler.bundle({
        appDirectory: sampleAppPath,
        outputPath: bundlePath,
      });
      await rewriteArchiveMetadata(bundlePath, (metadata) => {
        const manifest = metadata.manifest as { id: string };
        manifest.id = "com.example.other";
      });
      const result = await bundler.extract({
        edenitePath: bundlePath,
        outputDirectory: path.join(tempDir, "mismatch-output"),
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("does not match");
    });

    it("rejects archive links before they can escape extraction", async () => {
      const source = path.join(tempDir, "hostile-source");
      const archive = path.join(tempDir, "hostile.edenite");
      await fs.mkdir(source);
      await createArchiveWithLink(source, archive, {
        id: "com.example.hostile",
        name: "Hostile",
        version: "1.0.0",
        frontend: { entry: "index.html" },
      });
      const result = await bundler.extract({
        edenitePath: archive,
        outputDirectory: path.join(tempDir, "hostile-output"),
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unsupported archive entry type");
    });
  });
});
