import type { EdenConfig, SystemInfo } from "@edenapp/types";
import { command, defineController } from "../../core/controllers/controller";
export function createSystemController(
  config: EdenConfig,
  runningApps: () => string[],
) {
  return defineController("system", {
    commands: {
      info: command({
        handle: (): SystemInfo => ({
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          electronVersion: process.versions.electron,
          runningApps: runningApps(),
          release: config.development !== true,
        }),
      }),
    },
  });
}
