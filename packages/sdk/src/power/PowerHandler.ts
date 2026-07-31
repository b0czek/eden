import type { EdenPowerCapabilities } from "@edenapp/types";
import { inject, injectable, singleton } from "tsyringe";
import { CommandRegistry, EdenHandler, EdenNamespace } from "../ipc";
import { PowerManager } from "./PowerManager";

@singleton()
@injectable()
@EdenNamespace("system")
export class PowerHandler {
  constructor(
    @inject(PowerManager) private readonly manager: PowerManager,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
  ) {
    commandRegistry.registerManager(this);
  }

  @EdenHandler("power-capabilities", { permission: "power" })
  getCapabilities(): EdenPowerCapabilities {
    return this.manager.getCapabilities();
  }

  @EdenHandler("power", { permission: "power" })
  async power(args: { action: "poweroff" | "reboot" }): Promise<void> {
    await this.manager.power(args);
  }
}
