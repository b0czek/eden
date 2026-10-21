import type {
  SettingsCategory,
  SettingsPanelActionInputSchema,
  SettingsPanelValue,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import { EDEN_SETTINGS_APP_ID } from "../../constants";
import { cloneRendererValue } from "../serialization";
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

const loadAppsPanelData = Effect.fn(function* ({
  packages,
  settings,
  config,
}: BuiltinSettingsDependencies): Effect.fn.Return<SettingsPanelValue, Error> {
  const manifests = packages.listInstalledPackages({
    kind: "app",
    showHidden: true,
  });
  const autostartKeys = new Set(
    (yield* settings.list(EDEN_SETTINGS_APP_ID, true)).filter((key) =>
      key.startsWith("autostart."),
    ),
  );
  const apps = yield* Effect.forEach(
    manifests,
    (manifest) =>
      Effect.gen(function* () {
        const key = `autostart.${manifest.id}`;
        const [icon, hotReload, autostart] = yield* Effect.all(
          [
            packages.getPackageIcon(manifest.id),
            packages
              .isHotReloadEnabled(manifest.id)
              .pipe(Effect.catch(() => Effect.succeed(false))),
            autostartKeys.has(key)
              ? settings
                  .get(EDEN_SETTINGS_APP_ID, key)
                  .pipe(Effect.map((value) => value === "true"))
              : Effect.succeed(false),
          ],
          { concurrency: "unbounded" },
        );
        return { manifest, icon, hotReload, autostart };
      }),
    { concurrency: "unbounded" },
  );
  const dlcs = yield* Effect.forEach(
    packages.listInstalledPackages({ kind: "dlc" }),
    (manifest) =>
      Effect.map(
        packages
          .getPackageIcon(manifest.id)
          .pipe(Effect.catch(() => Effect.succeed(undefined))),
        (icon) => ({ manifest, icon }),
      ),
    { concurrency: "unbounded" },
  );
  return cloneRendererValue({
    apps,
    dlcs,
    development: config.development === true,
  }) as unknown as SettingsPanelValue;
});

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
      params: appActionSchema,
      value: { type: "boolean", required: true },
      handler: ({ settings }, invocation) =>
        settings.set(
          EDEN_SETTINGS_APP_ID,
          `autostart.${(invocation.params as { appId: string }).appId}`,
          invocation.value ? "true" : "false",
        ),
    },
    "toggle-hot-reload": {
      params: appActionSchema,
      handler: ({ packages }, invocation) =>
        Effect.asVoid(
          packages.toggleHotReload(
            (invocation.params as { appId: string }).appId,
          ),
        ),
    },
    "uninstall-package": {
      params: packageActionSchema,
      handler: ({ packages }, invocation) =>
        Effect.asVoid(
          packages.uninstallPackage(
            (invocation.params as { packageId: string }).packageId,
          ),
        ),
    },
  },
  createLoader: (dependencies) => () =>
    Effect.map(loadAppsPanelData(dependencies), (data) => ({ data })),
};
