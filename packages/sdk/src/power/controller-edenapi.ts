import * as v from "valibot";
import {
  command,
  defineController,
  operation,
} from "../controllers/controller";
import type { Power } from "./service";

export function createPowerController(power: Power) {
  return defineController("system", {
    commands: {
      "power-capabilities": command({
        permission: "power",
        handle: () => power.getCapabilities(),
      }),
      power: operation({
        permission: "power",
        transition: "runtime",
        input: v.object({
          action: v.picklist(
            ["poweroff", "reboot"],
            "Unsupported system power action",
          ),
        }),
        prepare: (args) => {
          power.assertAvailable(args);
          return (reporter) => power.power(args, reporter);
        },
      }),
    },
  });
}
