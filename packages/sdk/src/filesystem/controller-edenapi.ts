import { command, defineController } from "../controllers/controller";
import type { ExecutionContext } from "../execution/ExecutionContext";
import type { VolumeManager } from "./VolumeManager";
import { volumeEjectArgsSchema } from "./volume-schemas";

export function createVolumeController(
  manager: VolumeManager,
  execution: ExecutionContext,
) {
  function requirePrincipal(): void {
    const principal = execution.getPrincipal();
    if (principal?.kind !== "user" && principal?.kind !== "system")
      throw new Error("Caller has no volume execution principal");
  }
  return defineController("volume", {
    commands: {
      list: command({
        permission: "read",
        handle: () => {
          requirePrincipal();
          return manager.list();
        },
      }),
      eject: command({
        permission: "eject",
        mode: "operation",
        input: volumeEjectArgsSchema,
        handle: ({ volume }) => {
          requirePrincipal();
          return manager.prepareEject(volume);
        },
      }),
    },
    events: { changed: manager.changed },
  });
}
