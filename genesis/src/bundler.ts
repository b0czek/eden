import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import AdmZip from "adm-zip";

const execAsync = promisify(exec);

export interface AppManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  build?: {
    command: string;
    cwd?: string;
  };
  backend?: {
    entry: string;
    options?: any;
  };
  frontend: {
    entry: string;
  };
  permissions?: {
    system?: any;
    network?: any;
    filesystem?: any;
  };
  icon?: string;
}

export interface BundleOptions {
  appDirectory: string;
  outputPath?: string;
  verbose?: boolean;
}

export interface BundleResult {
  success: boolean;
  outputPath?: string;
  manifest?: AppManifest;
  error?: string;
}

/**
 * Genesis Bundler
 * Packages Eden apps into .edenite format
 */
export class GenesisBundler {
  private static isRemoteEntry(entry?: string): boolean {
    return !!entry && /^https?:\/\//i.test(entry);
  }

  /**
   * Execute build command if defined in manifest
   */
  static async executeBuild(
    appDirectory: string,
    manifest: AppManifest,
    verbose?: boolean
  ): Promise<{ success: boolean; error?: string }> {
    if (!manifest.build?.command) {
      return { success: true }; // No build command defined, skip
    }

    try {
      const buildCwd = manifest.build.cwd
        ? path.join(appDirectory, manifest.build.cwd)
        : appDirectory;

      if (verbose) {
        console.log(`🔨 Running build command: ${manifest.build.command}`);
        console.log(`   Working directory: ${buildCwd}`);
      }

      const { stdout, stderr } = await execAsync(manifest.build.command, {
        cwd: buildCwd,
        env: { ...process.env },
      });

      if (verbose && stdout) {
        console.log(`   ${stdout.trim()}`);
      }

      if (stderr && verbose) {
        console.log(`   ${stderr.trim()}`);
      }

      if (verbose) {
        console.log("✓ Build completed successfully");
      }

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: `Build failed: ${error.message}`,
      };
    }
  }

  /**
   * Validate an app manifest
   */
  static async validateManifest(
    manifestPath: string
  ): Promise<{ valid: boolean; errors: string[]; manifest?: AppManifest }> {
    const errors: string[] = [];

    try {
      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest: AppManifest = JSON.parse(content);

      // Required fields
      if (!manifest.id) errors.push("Missing required field: id");
      if (!manifest.name) errors.push("Missing required field: name");
      if (!manifest.version) errors.push("Missing required field: version");

      // Validate ID format
      if (manifest.id && !/^[a-z0-9\.\-]+$/.test(manifest.id)) {
        errors.push(
          "Invalid ID format. Use lowercase letters, numbers, dots, and hyphens only."
        );
      }

      // Backend validation (optional, but ensure entry if provided)
      if (manifest.backend && !manifest.backend.entry) {
        errors.push("Missing required field: backend.entry");
      }

      // Frontend validation
      if (!manifest.frontend) {
        errors.push("Missing required field: frontend");
      } else if (!manifest.frontend.entry) {
        errors.push("Missing required field: frontend.entry");
      } else if (
        !this.isRemoteEntry(manifest.frontend.entry) &&
        manifest.frontend.entry.startsWith("http")
      ) {
        errors.push("Invalid frontend.entry URL");
      }

      return {
        valid: errors.length === 0,
        errors,
        manifest: errors.length === 0 ? manifest : undefined,
      };
    } catch (error: any) {
      errors.push(`Failed to read/parse manifest: ${error.message}`);
      return { valid: false, errors };
    }
  }

  /**
   * Verify that required files exist
   */
  static async verifyFiles(
    appDirectory: string,
    manifest: AppManifest
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Check backend entry if defined
    if (manifest.backend?.entry) {
      const backendPath = path.join(appDirectory, manifest.backend.entry);
      try {
        await fs.access(backendPath);
      } catch {
        errors.push(`Backend entry file not found: ${manifest.backend.entry}`);
      }
    }

    // Check frontend entry unless it references a remote URL
    if (!this.isRemoteEntry(manifest.frontend.entry)) {
      const frontendPath = path.join(appDirectory, manifest.frontend.entry);
      try {
        await fs.access(frontendPath);
      } catch {
        errors.push(
          `Frontend entry file not found: ${manifest.frontend.entry}`
        );
      }
    }

    // Check icon if specified (warn but don't fail)
    if (manifest.icon) {
      const iconPath = path.join(appDirectory, manifest.icon);
      try {
        await fs.access(iconPath);
      } catch {
        // Icon is optional, so just warn in verbose mode
        // Don't add to errors array
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Bundle an app into .edenite format
   */
  static async bundle(options: BundleOptions): Promise<BundleResult> {
    const { appDirectory, outputPath, verbose } = options;

    try {
      if (verbose) console.log(`📦 Bundling app from: ${appDirectory}`);

      // Check if directory exists
      try {
        await fs.access(appDirectory);
      } catch {
        return {
          success: false,
          error: `App directory not found: ${appDirectory}`,
        };
      }

      // Read and validate manifest
      const manifestPath = path.join(appDirectory, "manifest.json");
      const validation = await this.validateManifest(manifestPath);

      if (!validation.valid) {
        return {
          success: false,
          error: `Invalid manifest:\n${validation.errors.join("\n")}`,
        };
      }

      const manifest = validation.manifest!;

      if (verbose) {
        console.log(`✓ Manifest valid: ${manifest.name} v${manifest.version}`);
      }

      // Execute build command if defined (before verifying files, as build may create them)
      const buildResult = await this.executeBuild(
        appDirectory,
        manifest,
        verbose
      );
      if (!buildResult.success) {
        return {
          success: false,
          error: buildResult.error,
        };
      }

      // Verify required files exist (after build)
      const fileCheck = await this.verifyFiles(appDirectory, manifest);
      if (!fileCheck.valid) {
        return {
          success: false,
          error: `Missing files:\n${fileCheck.errors.join("\n")}`,
        };
      }

      if (verbose) console.log("✓ All required files present");

      // Create zip archive
      const zip = new AdmZip();

      // Add all files from the app directory
      const files = await fs.readdir(appDirectory, { recursive: true });

      for (const file of files) {
        const filePath = path.join(appDirectory, file as string);
        const stat = await fs.stat(filePath);

        if (stat.isFile()) {
          const content = await fs.readFile(filePath);
          zip.addFile(file as string, content);
          if (verbose) console.log(`  + ${file}`);
        }
      }

      // Determine output path
      const finalOutputPath =
        outputPath ||
        path.join(process.cwd(), `${manifest.id}-${manifest.version}.edenite`);

      // Write the .edenite file
      await fs.mkdir(path.dirname(finalOutputPath), { recursive: true });
      zip.writeZip(finalOutputPath);

      if (verbose) {
        console.log(`✓ Bundle created: ${finalOutputPath}`);
        const stats = await fs.stat(finalOutputPath);
        console.log(`  Size: ${(stats.size / 1024).toFixed(2)} KB`);
      }

      return {
        success: true,
        outputPath: finalOutputPath,
        manifest,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Bundle failed: ${error.message}`,
      };
    }
  }

  /**
   * Extract info from an .edenite file
   */
  static async getInfo(
    edenitePath: string
  ): Promise<{ success: boolean; manifest?: AppManifest; error?: string }> {
    try {
      const zip = new AdmZip(edenitePath);
      const manifestEntry = zip.getEntry("manifest.json");

      if (!manifestEntry) {
        return { success: false, error: "No manifest.json found in archive" };
      }

      const manifestContent = zip.readAsText(manifestEntry);
      const manifest: AppManifest = JSON.parse(manifestContent);

      return { success: true, manifest };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to read archive: ${error.message}`,
      };
    }
  }
}
