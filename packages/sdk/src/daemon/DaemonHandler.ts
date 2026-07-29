import type { DaemonDefinition, DaemonStatus } from "@edenapp/types";
import { EdenHandler, EdenNamespace } from "../ipc";
import type { DaemonManager } from "./DaemonManager";

@EdenNamespace("daemon")
export class DaemonHandler {
  constructor(private manager: DaemonManager) {}

  @EdenHandler("list", { permission: "read" })
  async list(): Promise<DaemonStatus[]> {
    return this.manager.list();
  }

  @EdenHandler("update-definition", { permission: "manage" })
  async updateDefinition(args: {
    definition: DaemonDefinition;
  }): Promise<{ success: true }> {
    await this.manager.updateDefinition(args.definition);
    return { success: true };
  }

  @EdenHandler("enable", { permission: "manage" })
  async enable(args: { appId: string }): Promise<{ success: true }> {
    await this.manager.setEnabled(args.appId, true);
    return { success: true };
  }

  @EdenHandler("disable", { permission: "manage" })
  async disable(args: { appId: string }): Promise<{ success: true }> {
    await this.manager.setEnabled(args.appId, false);
    return { success: true };
  }

  @EdenHandler("start", { permission: "manage" })
  async start(args: { appId: string }): Promise<{ success: true }> {
    await this.manager.start(args.appId);
    return { success: true };
  }

  @EdenHandler("stop", { permission: "manage" })
  async stop(args: { appId: string }): Promise<{ success: true }> {
    await this.manager.stop(args.appId);
    return { success: true };
  }

  @EdenHandler("restart", { permission: "manage" })
  async restart(args: { appId: string }): Promise<{ success: true }> {
    await this.manager.restart(args.appId);
    return { success: true };
  }
}
