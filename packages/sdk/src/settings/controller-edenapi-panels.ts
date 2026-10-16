import type { SettingsPanelActionInvocation } from "@edenapp/types";
import * as v from "valibot";
import { command, defineController } from "../controllers/controller";
import type { SettingsPanels } from "./panel-service";
export function createSettingsPanelsController(panels: SettingsPanels) {
  return defineController("settings", {
    commands: {
      panels: command({
        permission: "panels",
        handle: () =>
          panels.listPanels().pipe(Effect.map((panels) => ({ panels }))),
      }),
      panel: command({
        permission: "panels",
        input: v.object({ panelId: v.string() }),
        handle: ({ panelId }) => panels.loadPanel(panelId),
      }),
      action: command({
        permission: "panels",
        input: v.object({
          panelId: v.string(),
          actionId: v.string(),
          invocation: v.optional(
            v.custom<SettingsPanelActionInvocation>(
              (value) =>
                value !== null &&
                typeof value === "object" &&
                !Array.isArray(value),
            ),
            {},
          ),
        }),
        handle: ({ panelId, actionId, invocation }) =>
          panels.invokeAction(panelId, actionId, invocation),
      }),
    },
    events: { "panels-changed": panels.changed },
  });
}

import * as Effect from "effect/Effect";
