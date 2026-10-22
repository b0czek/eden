import { command, defineController } from "../../core/controllers/controller";
import type { Branding } from "./service";

export function createBrandingController(branding: Branding) {
  return defineController("system", {
    commands: {
      /** Get consumer-controlled product branding for SDK-owned interfaces. */
      branding: command({ handle: () => branding.getInfo() }),
    },
  });
}
