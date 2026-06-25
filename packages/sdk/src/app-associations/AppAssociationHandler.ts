import type { AppAssociation } from "@edenapp/types";
import { EdenHandler, EdenNamespace } from "../ipc";
import type { AppAssociationManager } from "./AppAssociationManager";

@EdenNamespace("associations")
export class AppAssociationHandler {
  constructor(private manager: AppAssociationManager) {}

  @EdenHandler("get")
  handleGet(args: { key: string }): {
    association: AppAssociation | undefined;
  } {
    return { association: this.manager.get(args.key) };
  }

  @EdenHandler("set")
  async handleSet(args: {
    key: string;
    appId: string;
    kind: string;
    label?: string;
  }): Promise<{ success: boolean }> {
    const { key, ...association } = args;
    await this.manager.set(key, association);
    return { success: true };
  }

  @EdenHandler("remove")
  async handleRemove(args: { key: string }): Promise<{ success: boolean }> {
    await this.manager.remove(args.key);
    return { success: true };
  }

  @EdenHandler("list")
  handleList(args: { kindPrefix?: string }): {
    associations: Record<string, AppAssociation>;
  } {
    return { associations: this.manager.list(args) };
  }
}
