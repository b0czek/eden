import { OperationManager } from "../operations/OperationManager";
import type { OperationReporter } from "../operations/OperationTask";
import type {
  EdenConfig,
  EdenPowerCapabilities,
  EdenPowerProvider,
} from "@edenapp/types";
import { inject, injectable, Lifecycle, scoped } from "tsyringe";
import { DaemonManager } from "../daemon";
import { ProcessManager } from "../process-manager";

const unavailableCapabilities: EdenPowerCapabilities = {
  poweroff: false,
  reboot: false,
};

@scoped(Lifecycle.ContainerScoped)
@injectable()
export class PowerManager {
  private readonly provider?: EdenPowerProvider;
  private powerActionPending = false;

  constructor(
    @inject("EdenConfig") config: EdenConfig,
    @inject(DaemonManager) private daemonManager: DaemonManager,
    @inject(ProcessManager) private processManager: ProcessManager,
    @inject(OperationManager) private operations: OperationManager,
  ) {
    this.provider = config.powerProvider;
  }

  getCapabilities(): EdenPowerCapabilities {
    if (!this.provider) return unavailableCapabilities;

    return {
      poweroff: typeof this.provider.poweroff === "function",
      reboot: typeof this.provider.reboot === "function",
    };
  }

  validatePower(args: { action: "poweroff" | "reboot" }): void {
    if (this.powerActionPending) {
      throw new Error("A system power action is already pending");
    }

    const provider = this.provider;
    if (!provider) {
      throw new Error("System power management is unavailable");
    }

    if (args.action !== "poweroff" && args.action !== "reboot") {
      throw new Error("Unsupported system power action");
    }

    const action = provider[args.action];
    if (typeof action !== "function") {
      throw new Error(`System ${args.action} is unavailable`);
    }
  }

  async power(
    args: { action: "poweroff" | "reboot" },
    reporter?: OperationReporter,
  ): Promise<void> {
    this.validatePower(args);
    const provider = this.provider!;
    const action = provider[args.action]!;
    this.powerActionPending = true;
    try {
      await this.operations.withRuntimeTransition(async () => {
        reporter?.update("preparing-host-handoff");
        await this.daemonManager.shutdown();
        await this.processManager.shutdown();
        reporter?.update("host-handoff");
        await action.call(provider);
      });
    } catch (error) {
      this.powerActionPending = false;
      throw error;
    }
  }

  dispose(): void {
    this.powerActionPending = false;
  }
}
