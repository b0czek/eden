import { command, defineController } from "../controllers/controller";
import type { ExecutionContext } from "../execution/context";
import { FilesystemAccessDenied } from "./errors";
import { volumeEjectArgsSchema } from "./volume-schemas";
import type { Volumes } from "./volumes";

export function createVolumeController(
  volumes: Volumes,
  execution: ExecutionContext,
) {
  function requirePrincipal(): void {
    const principal = execution.getPrincipal();
    if (principal?.kind !== "user" && principal?.kind !== "system")
      throw new FilesystemAccessDenied({
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
