import type { OperationHandle, OperationSnapshot } from "@edenapp/types";
import * as v from "valibot";
import { EdenHandler, EdenNamespace } from "../ipc/CommandDecorators";
import type { OperationManager } from "./OperationManager";

const handleSchema = v.object({ command: v.string(), id: v.string() });

@EdenNamespace("operation")
export class OperationHandler {
  constructor(private manager: OperationManager) {}

  @EdenHandler("get")
  get(args: { handle: OperationHandle }): OperationSnapshot {
    return this.manager.get(v.parse(handleSchema, args.handle));
  }

  @EdenHandler("cancel")
  cancel(args: { handle: OperationHandle }): void {
    this.manager.cancel(v.parse(handleSchema, args.handle));
  }

  @EdenHandler("list")
  list(): OperationSnapshot[] {
    return this.manager.list();
  }
}
