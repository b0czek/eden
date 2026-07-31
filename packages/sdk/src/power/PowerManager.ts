import type {
  EdenConfig,
  EdenPowerCapabilities,
  EdenPowerProvider,
} from "@edenapp/types";
import { inject, injectable, singleton } from "tsyringe";
import { DaemonManager } from "../daemon";
import { ProcessManager } from "../process-manager";

const unavailableCapabilities: EdenPowerCapabilities = {
  poweroff: false,
  reboot: false,
};

@singleton()
@injectable()
export class PowerManager {
  private readonly provider?: EdenPowerProvider;
  private powerActionPending = false;

  constructor(
    @inject("EdenConfig") config: EdenConfig,
    @inject(DaemonManager) private daemonManager: DaemonManager,
    @inject(ProcessManager) private processManager: ProcessManager,
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

  async power(args: { action: "poweroff" | "reboot" }): Promise<void> {
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

    this.powerActionPending = true;
    try {
      // Power requests are transactional system operations: stop managed work
      // before handing control to the host integration.
      await this.daemonManager.shutdown();
      await this.processManager.shutdown();
      await action.call(provider);
    } catch (error) {
      this.powerActionPending = false;
      throw error;
    }
  }
}
