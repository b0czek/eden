import * as v from "valibot";
import { command, defineController } from "../controllers/controller";
import type { PowerOperations } from "./operations";
import type { Power } from "./service";

export function createPowerController(
  power: Power,
  operations: PowerOperations,
) {
  return defineController("system", {
    commands: {
      "power-capabilities": command({
        permission: "power",
        handle: () => power.getCapabilities(),
      }),
      power: command({
        permission: "power",
        mode: "operation",
        input: v.object({
          action: v.picklist(
            ["poweroff", "reboot"],
            "Unsupported system power action",
          ),
        }),
        handle: (args) => operations.preparePower(args),
      }),
    },
  });
}
