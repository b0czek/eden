import type { RuntimeAppManifest, UserProfile } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { PackageCatalog } from "../../../src/applications/packages/catalog";
import {
  ExecutionContext,
  ExecutionContextLive,
} from "../../../src/core/execution/context";
import {
  createPanelRegistry,
  PanelRegistry,
} from "../../../src/core/settings/panels/registry";
import {
  SettingsPanels,
  SettingsPanelsLive,
} from "../../../src/core/settings/panels/service";
import {
  SettingsCatalog,
  SettingsStorage,
} from "../../../src/core/settings/ports";
import { Settings, SettingsLive } from "../../../src/core/settings/service";
import { SessionContext } from "../../../src/desktop/session/context";
import { RuntimeConfig } from "../../../src/runtime/inputs";
import { createTestExecutionContext } from "../callers";
import { buildService, createEffectRuntime } from "../effect-runtime";
import { panelUser } from "./panels";

const serviceEffects = createEffectRuntime();
afterAll(() => serviceEffects.dispose());

export function createSettingsPanelHarness(
  initialUser = panelUser(["panels/network"]),
) {
  let currentUser: UserProfile | null = initialUser;
  let sessionId = "session-1";
  const notify = jest.fn();
  const storedValues = new Map<string, string>();
  const realSettings = serviceEffects.acquireSync(
    buildService(Settings, SettingsLive).pipe(
      Effect.provideServiceEffect(
        ExecutionContext,
        createTestExecutionContext(() => true),
      ),
      Effect.provideService(SettingsCatalog, {
        getAppSettings: () => undefined,
      }),
      Effect.provideService(SettingsStorage, {
        read: (key) => Effect.sync(() => storedValues.get(key)),
        readMany: (keys) =>
          Effect.sync(() => keys.map((key) => storedValues.get(key))),
        write: (key, value) =>
          Effect.sync(() => {
            storedValues.set(key, value);
          }),
        remove: (key) =>
          Effect.sync(() => {
            storedValues.delete(key);
          }),
        keys: () => Effect.sync(() => [...storedValues.keys()]),
      }),
    ),
  );
  const settings = {
    ...realSettings,
    get: jest.fn<ReturnType<Settings["get"]>, [string, string]>(() =>
      Effect.succeed(undefined),
    ),
    set: jest.fn<ReturnType<Settings["set"]>, [string, string, string]>(
      () => Effect.void,
    ),
  };
  const unexpectedCatalogAccess = (): never => {
    throw new Error("Unexpected catalog access in panel fixture");
  };
  const catalog = {
    dlcDirectory: "",
    get: unexpectedCatalogAccess,
    has: unexpectedCatalogAccess,
    all: unexpectedCatalogAccess,
    getApp: unexpectedCatalogAccess,
    hasApp: unexpectedCatalogAccess,
    prebuiltApps: unexpectedCatalogAccess,
    installedApps: unexpectedCatalogAccess,
    developmentApps: unexpectedCatalogAccess,
    listApps: unexpectedCatalogAccess,
    getLaunchableApp: unexpectedCatalogAccess,
    getDlc: unexpectedCatalogAccess,
    hasDlc: unexpectedCatalogAccess,
    allDlcs: unexpectedCatalogAccess,
    dlcsForHost: unexpectedCatalogAccess,
    getPath: unexpectedCatalogAccess,
    getSize: unexpectedCatalogAccess,
    resolveContainedDlcPath: unexpectedCatalogAccess,
    allApps: jest.fn<RuntimeAppManifest[], []>(() => []),
    getIcon: jest.fn<Effect.Effect<string | undefined>, [string]>(() =>
      Effect.succeed(undefined),
    ),
  };
  const execution = serviceEffects.acquireSync(
    buildService(ExecutionContext, ExecutionContextLive).pipe(
      Effect.provideService(RuntimeConfig, {}),
    ),
  );
  const panels = serviceEffects.acquireSync(
    buildService(SettingsPanels, SettingsPanelsLive).pipe(
      Effect.provideService(Settings, settings),
      Effect.provideService(PackageCatalog, catalog),
      Effect.provideService(SessionContext, {
        getCurrentUser: () =>
          currentUser
            ? { ...currentUser, grants: [...currentUser.grants] }
            : null,
        getSessionId: () => sessionId,
      } as SessionContext),
      Effect.provideService(ExecutionContext, execution),
      Effect.provideService(PanelRegistry, createPanelRegistry()),
    ),
  );
  panels.changed.on(notify);
  return {
    panels,
    settings,
    catalog,
    execution,
    notify,
    setUser(next: UserProfile | null) {
      currentUser = next;
    },
    setSession(next: string) {
      sessionId = next;
    },
  };
}
