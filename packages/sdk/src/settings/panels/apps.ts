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
  packageManager,
  settings,
  config,
}: BuiltinSettingsDependencies): Promise<SettingsPanelValue> => {
  const manifests = packageManager.listInstalledPackages({
    kind: "app",
    showHidden: true,
  });
  const storedKeys = await settings.list(EDEN_SETTINGS_APP_ID, true);
  const autostartKeys = new Set(
    storedKeys.filter((key) => key.startsWith("autostart.")),
  );
  const apps = await Promise.all(
    manifests.map(async (manifest) => {
      const autostartKey = `autostart.${manifest.id}`;
      const [icon, hotReload, autostart] = await Promise.all([
        packageManager.getPackageIcon(manifest.id),
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
  const dlcs = await Promise.all(
    packageManager
      .listInstalledPackages({ kind: "dlc" })
      .map(async (manifest) => ({
        manifest,
        icon: await packageManager
          .getPackageIcon(manifest.id)
          .catch(() => undefined),
      })),
  );
  return cloneRendererValue({
    apps,
    dlcs,
    development: config.development === true,
  }) as unknown as SettingsPanelValue;
};

const appActionSchema: SettingsPanelActionInputSchema = {
  type: "object",
  required: true,
  properties: { appId: { type: "string", required: true } },
  additionalProperties: false,
};

const packageActionSchema: SettingsPanelActionInputSchema = {
  type: "object",
  required: true,
  properties: { packageId: { type: "string", required: true } },
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
    "uninstall-package": {
      input: packageActionSchema,
      handler: async ({ packageManager }, input) => {
        await packageManager.uninstallPackage(
          (input as unknown as { packageId: string }).packageId,
        );
      },
    },
  },
  createLoader: (dependencies) => async () => ({
    data: await loadAppsPanelData(dependencies),
  }),
};
