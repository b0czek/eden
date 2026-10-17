import * as Effect from "effect/Effect";
import * as v from "valibot";
import type { EdenSettingsApi } from "../api/settings";
import {
  cloneAndValidatePanelDefinition,
  validatePanelProvider,
} from "./panel-codec";
import type { PanelRegistry } from "./panel-registry";

const registrationOptionsSchema = v.optional(
  v.object({
    visible: v.optional(v.boolean()),
  }),
  {},
);

/** Registration is synchronous and remains available before runtime startup. */
export function createSettingsSdkController({
  panels,
}: {
  panels: Pick<PanelRegistry, "registerPanel">;
}): EdenSettingsApi {
  return {
    registerPanel: (definition, provider, options) => {
      const copied = cloneAndValidatePanelDefinition(definition);
      validatePanelProvider(copied, provider);
      const parsedOptions = v.parse(registrationOptionsSchema, options);
      const registration = panels.registerPanel(
        copied,
        {
          load: (context) =>
            Effect.suspend(() => provider.load.call(provider, context)),
          actions: Object.fromEntries(
            Object.entries(provider.actions ?? {}).map(([id, handler]) => [
              id,
              (invocation, context) =>
                Effect.suspend(() =>
                  handler.call(provider, invocation, context),
                ),
            ]),
          ),
        },
        parsedOptions,
      );
      return Object.freeze({
        panelId: registration.panelId,
        invalidate: registration.invalidate,
        setVisible: (visible: boolean) =>
          registration.setVisible(v.parse(v.boolean(), visible)),
        unregister: registration.unregister,
      });
    },
  };
}
