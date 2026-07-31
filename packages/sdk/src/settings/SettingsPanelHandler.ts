import type {
  SettingsPanelActionResponse,
  SettingsPanelResponse,
  SettingsPanelSummary,
  SettingsPanelValue,
} from "@edenapp/types";
import { EdenHandler, EdenNamespace, registerEventPermission } from "../ipc";
import type { SettingsPanelManager } from "./SettingsPanelManager";

registerEventPermission("settings/panels-changed", "settings/panels");

@EdenNamespace("settings")
export class SettingsPanelHandler {
  constructor(private readonly manager: SettingsPanelManager) {}

  /** List the settings panels visible to the active user. */
  @EdenHandler("panels", { permission: "panels" })
  async panels(): Promise<{ panels: SettingsPanelSummary[] }> {
    return { panels: await this.manager.listPanels() };
  }

  /** Load one authorized panel declaration and its current state. */
  @EdenHandler("panel", { permission: "panels" })
  async panel(args: { panelId: string }): Promise<SettingsPanelResponse> {
    return this.manager.loadPanel(args.panelId);
  }

  /** Invoke one declared panel-private action. */
  @EdenHandler("action", { permission: "panels" })
  async action(args: {
    panelId: string;
    actionId: string;
    input?: SettingsPanelValue;
  }): Promise<SettingsPanelActionResponse> {
    return this.manager.invokeAction(args.panelId, args.actionId, args.input);
  }
}
