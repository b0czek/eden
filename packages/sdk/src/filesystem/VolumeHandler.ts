import type { FilesystemVolume } from "@edenapp/types";
import * as v from "valibot";
import type { ExecutionContext } from "../execution/ExecutionContext";
import { EdenHandler, EdenNamespace } from "../ipc";
import type { OperationTask } from "../operations/OperationTask";
import type { VolumeManager } from "./VolumeManager";

@EdenNamespace("volume")
export class VolumeHandler {
  constructor(
    private manager: VolumeManager,
    private execution: ExecutionContext,
  ) {}

  @EdenHandler("list", { permission: "read" })
  list(_args: Record<string, never>): FilesystemVolume[] {
    this.requirePrincipal();
    return this.manager.list();
  }

  /** Safely eject a device after draining admitted volume I/O. */
  @EdenHandler("eject", { permission: "eject", mode: "operation" })
  eject(args: { volume: string }): OperationTask<void> {
    const { volume } = v.parse(
      v.object({ volume: v.pipe(v.string(), v.nonEmpty()) }),
      args,
    );
    this.requirePrincipal();
    return this.manager.prepareEject(volume);
  }

  private requirePrincipal(): void {
    const principal = this.execution.getPrincipal();
    if (principal?.kind !== "user" && principal?.kind !== "system")
      throw new Error("Caller has no volume execution principal");
  }
}
