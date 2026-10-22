import {
  command,
  defineController,
} from "../../../core/controllers/controller";
import type { ExecutionContext } from "../../../core/execution/context";
import { VolumeAccessDenied } from "./errors";
import { volumeEjectArgsSchema } from "./schemas";
import type { Volumes } from "./service";

export function createVolumeController(
  volumes: Volumes,
  execution: ExecutionContext,
) {
  function requirePrincipal(): void {
    const principal = execution.getPrincipal();
    if (principal?.kind !== "user" && principal?.kind !== "system")
      throw new VolumeAccessDenied({
        message: "Caller has no volume execution principal",
      });
  }
  return defineController("volume", {
    commands: {
      list: command({
        permission: "read",
        handle: () => {
          requirePrincipal();
          return volumes.list();
        },
      }),
      eject: command({
        permission: "eject",
        mode: "operation",
        input: volumeEjectArgsSchema,
        handle: ({ volume }) => {
          requirePrincipal();
          return volumes.prepareEject(volume);
        },
      }),
    },
    events: { changed: volumes.changed },
  });
}
