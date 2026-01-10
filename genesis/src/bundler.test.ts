import { GenesisBundler } from "./bundler";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";

describe("GenesisBundler", () => {
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
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe("validateManifest", () => {
    it("should validate a correct manifest", async () => {
      const manifestPath = path.join(sampleAppPath, "manifest.json");
      const result = await GenesisBundler.validateManifest(manifestPath);

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
        JSON.stringify({ name: "Test" }) // Missing required fields
      );

      const result = await GenesisBundler.validateManifest(invalidManifestPath);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("verifyFiles", () => {
    it("should verify files exist for sample app", async () => {
      const manifestPath = path.join(sampleAppPath, "manifest.json");
      const validation = await GenesisBundler.validateManifest(manifestPath);

      expect(validation.valid).toBe(true);

      const result = await GenesisBundler.verifyFiles(
        sampleAppPath,
        validation.manifest!
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("bundle", () => {
    it("should bundle the sample app successfully", async () => {
      const outputPath = path.join(tempDir, "test-app.edenite");

      const result = await GenesisBundler.bundle({
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

      const result = await GenesisBundler.bundle({
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

      const result1 = await GenesisBundler.bundle({
        appDirectory: sampleAppPath,
        outputPath: outputPath1,
        compressionLevel: 1,
        verbose: false,
      });

      const result22 = await GenesisBundler.bundle({
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
        await fs.readFile(manifestPath, "utf-8")
      );
      manifestContent.include = ["extra-data.txt"];
      await fs.writeFile(manifestPath, JSON.stringify(manifestContent));

      // 4. Bundle
      const outputPath = path.join(tempDir, "include-test.edenite");
      const result = await GenesisBundler.bundle({
        appDirectory: tempAppPath,
        outputPath,
        verbose: false,
      });

      expect(result.success).toBe(true);

      // 5. Extract and verify
      const extractPath = path.join(tempDir, "extracted-include");
      await GenesisBundler.extract({
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
      const bundleResult = await GenesisBundler.bundle({
        appDirectory: sampleAppPath,
        outputPath,
        verbose: false,
      });

      expect(bundleResult.success).toBe(true);

      // Now read the info
      const infoResult = await GenesisBundler.getInfo(outputPath);

      expect(infoResult.success).toBe(true);
      expect(infoResult.manifest?.id).toBe("com.example.hello");
      expect(infoResult.manifest?.name).toBe("Hello Eden");
      expect(infoResult.checksum).toBe(bundleResult.checksum);
    }, 30000);
  });

  describe("extract", () => {
    it("should extract bundled archive", async () => {
      const bundlePath = path.join(tempDir, "test-extract.edenite");
      const extractPath = path.join(tempDir, "extracted");

      // First bundle the app
      const bundleResult = await GenesisBundler.bundle({
        appDirectory: sampleAppPath,
        outputPath: bundlePath,
        verbose: false,
      });

      expect(bundleResult.success).toBe(true);

      // Now extract it
      const extractResult = await GenesisBundler.extract({
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
      await GenesisBundler.bundle({
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
      const extractResult = await GenesisBundler.extract({
        edenitePath: bundlePath,
        outputDirectory: extractPath,
        verbose: false,
        verifyChecksum: true,
      });

      expect(extractResult.success).toBe(false);
      expect(extractResult.error).toContain("Checksum mismatch");
    }, 30000);
  });
});
