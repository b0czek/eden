import { exec } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import type { AppManifest } from "@edenapp/types";

const execAsync = promisify(exec);

export async function executeBuild(
  appDirectory: string,
  manifest: AppManifest,
  verbose?: boolean,
): Promise<{ success: boolean; error?: string }> {
  if (!manifest.build?.command) return { success: true };
  try {
    const cwd = manifest.build.cwd
      ? path.join(appDirectory, manifest.build.cwd)
      : appDirectory;
    if (verbose)
      console.log(`🔨 Running build command: ${manifest.build.command}`);
    const { stdout, stderr } = await execAsync(manifest.build.command, {
      cwd,
      env: { ...process.env },
    });
    if (verbose && stdout) console.log(`   ${stdout.trim()}`);
    if (verbose && stderr) console.log(`   ${stderr.trim()}`);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Build failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
