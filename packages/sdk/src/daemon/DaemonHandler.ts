import type { DaemonDefinition, DaemonStatus } from "@edenapp/types";
import * as v from "valibot";
import { EdenHandler, EdenNamespace } from "../ipc";
import { type OperationTask, operationTask } from "../operations/OperationTask";
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

  @EdenHandler("start", { permission: "manage", mode: "operation" })
  start(args: { appId: string }): OperationTask<{ success: true }> {
    const appId = v.parse(v.pipe(v.string(), v.nonEmpty()), args.appId);
    return operationTask(async (reporter) => {
      reporter.update("starting-daemon");
      await this.manager.start(appId);
      return { success: true };
    });
  }

  @EdenHandler("stop", { permission: "manage", mode: "operation" })
  stop(args: { appId: string }): OperationTask<{ success: true }> {
    const appId = v.parse(v.pipe(v.string(), v.nonEmpty()), args.appId);
    return operationTask(async (reporter) => {
      reporter.update("stopping-daemon");
      await this.manager.stop(appId);
      return { success: true };
    });
  }

  @EdenHandler("restart", { permission: "manage", mode: "operation" })
  restart(args: { appId: string }): OperationTask<{ success: true }> {
    const appId = v.parse(v.pipe(v.string(), v.nonEmpty()), args.appId);
    return operationTask(async (reporter) => {
      reporter.update("restarting-daemon");
      await this.manager.restart(appId);
      return { success: true };
    });
  }
}
