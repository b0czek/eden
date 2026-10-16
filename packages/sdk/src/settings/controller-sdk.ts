import * as v from "valibot";
import type { EdenSettingsApi } from "../api/EdenSettingsApi";
import type { SdkContext } from "../api/sdk-context";
import { fromPromise } from "../effects/io";
import {
  cloneAndValidatePanelDefinition,
  validatePanelProvider,
} from "./SettingsPanelCodec";
import type { SettingsPanelManager } from "./SettingsPanelManager";

const registrationOptionsSchema = v.optional(
  v.object({
    visible: v.optional(v.boolean()),
  }),
  {},
);

/** Registration is synchronous and remains available before runtime startup. */
export function createSettingsSdkController({
  panels,
  sdk,
}: {
  panels: SettingsPanelManager;
  sdk: SdkContext;
}): EdenSettingsApi {
  return {
    registerPanel: (definition, provider, options) =>
      sdk.run(() => {
        const copied = cloneAndValidatePanelDefinition(definition);
        validatePanelProvider(copied, provider);
        const parsedOptions = v.parse(registrationOptionsSchema, options);
        const registration = panels.registerPanel(
          copied,
          {
            load: (context) =>
              fromPromise(() =>
                Promise.resolve(provider.load.call(provider, context)),
              ),
            actions: Object.fromEntries(
              Object.entries(provider.actions ?? {}).map(([id, handler]) => [
                id,
                (invocation, context) =>
                  fromPromise(() =>
                    Promise.resolve(
                      handler.call(provider, invocation, context),
                    ),
                  ),
              ]),
            ),
          },
          parsedOptions,
        );
        return Object.freeze({
          panelId: registration.panelId,
          invalidate: () => sdk.run(registration.invalidate),
          setVisible: (visible: boolean) =>
            sdk.run(() =>
              registration.setVisible(v.parse(v.boolean(), visible)),
            ),
          unregister: () => sdk.run(registration.unregister),
        });
      }),
  };
}
