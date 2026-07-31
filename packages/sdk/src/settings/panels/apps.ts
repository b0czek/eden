import type {
  SettingsCategory,
  SettingsPanelActionInputSchema,
  SettingsPanelValue,
} from "@edenapp/types";
import { EDEN_SETTINGS_APP_ID } from "../constants";
import { cloneRendererValue } from "../SettingsPanelCodec";
import type { BuiltinPanelModule, BuiltinSettingsDependencies } from "./types";

export const appsSettingsCategory = {
  id: "apps",
  name: { en: "Installed Apps", pl: "Zainstalowane aplikacje" },
  description: {
    en: "Manage installed applications, system services, and daemons.",
    pl: "Zarządzaj zainstalowanymi aplikacjami, usługami systemowymi i demonami.",
  },
  icon: "package",
  view: "apps" as const,
  grant: "preset/package/manage",
  grantScope: "global",
  settings: [],
} satisfies SettingsCategory;

const loadAppsPanelData = async ({
  appCatalog,
  packageManager,
  settings,
  config,
}: BuiltinSettingsDependencies): Promise<SettingsPanelValue> => {
  const manifests = appCatalog.list({ showHidden: true });
  const storedKeys = await settings.list(EDEN_SETTINGS_APP_ID, true);
  const autostartKeys = new Set(
    storedKeys.filter((key) => key.startsWith("autostart.")),
  );
  const apps = await Promise.all(
    manifests.map(async (manifest) => {
      const autostartKey = `autostart.${manifest.id}`;
      const [icon, hotReload, autostart] = await Promise.all([
        appCatalog.getIcon(manifest.id),
        packageManager.isHotReloadEnabled(manifest.id).catch(() => false),
        autostartKeys.has(autostartKey)
          ? settings
              .get(EDEN_SETTINGS_APP_ID, autostartKey)
              .then((value) => value === "true")
          : false,
      ]);
      return { manifest, icon, hotReload, autostart };
    }),
  );
  return cloneRendererValue({
    apps,
    development: config.development === true,
  }) as unknown as SettingsPanelValue;
};

const appActionSchema: SettingsPanelActionInputSchema = {
  type: "object",
  required: true,
  properties: { appId: { type: "string", required: true } },
  additionalProperties: false,
};

export const appsPanel: BuiltinPanelModule = {
  kind: "custom",
  category: appsSettingsCategory,
  actions: {
    "set-autostart": {
      input: {
        type: "object",
        required: true,
        properties: {
          appId: { type: "string", required: true },
          enabled: { type: "boolean", required: true },
        },
        additionalProperties: false,
      },
      handler: async ({ settings }, input) => {
        const { appId, enabled } = input as unknown as {
          appId: string;
          enabled: boolean;
        };
        await settings.set(
          EDEN_SETTINGS_APP_ID,
          `autostart.${appId}`,
          enabled ? "true" : "false",
        );
      },
    },
    "toggle-hot-reload": {
      input: appActionSchema,
      handler: async ({ packageManager }, input) => {
        await packageManager.toggleHotReload(
          (input as unknown as { appId: string }).appId,
        );
      },
    },
    uninstall: {
      input: appActionSchema,
      handler: async ({ packageManager }, input) => {
        await packageManager.uninstallApp(
          (input as unknown as { appId: string }).appId,
        );
      },
    },
  },
  createLoader: (dependencies) => async () => ({
    data: await loadAppsPanelData(dependencies),
  }),
};
