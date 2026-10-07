import { operationTask, type OperationTask } from "../operations/OperationTask";
import type { EdenPowerCapabilities } from "@edenapp/types";
import { inject, injectable, Lifecycle, scoped } from "tsyringe";
import { CommandRegistry, EdenHandler, EdenNamespace } from "../ipc";
import { PowerManager } from "./PowerManager";

@scoped(Lifecycle.ContainerScoped)
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

  @EdenHandler("power", { permission: "power", mode: "operation" })
  power(args: { action: "poweroff" | "reboot" }): OperationTask<void> {
    this.manager.validatePower(args);
    return operationTask((reporter) => this.manager.power(args, reporter), {
      transition: "runtime",
    });
  }
}
