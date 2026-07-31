import type { AppAssociationManager } from "../app-associations";
import type { AppCatalog } from "../app-registry";
import type { AppearanceManager } from "../appearance/AppearanceManager";
import type { DaemonManager } from "../daemon";
import type { ExecutionContext } from "../execution";
import type { PackageManager } from "../package-manager";
import type { SessionManager } from "../session";
import type { UserManager } from "../user";
import type {
  EdenAppearanceApi,
  EdenAppsApi,
  EdenAssociationsApi,
  EdenDaemonsApi,
  EdenSessionsApi,
  EdenUsersApi,
} from "./ControlPlaneApi";

export interface EdenControlPlaneApis {
  apps: EdenAppsApi;
  daemons: EdenDaemonsApi;
  users: EdenUsersApi;
  sessions: EdenSessionsApi;
  appearance: EdenAppearanceApi;
  associations: EdenAssociationsApi;
}

interface Dependencies {
  appCatalog: AppCatalog;
  packageManager: PackageManager;
  daemonManager: DaemonManager;
  userManager: UserManager;
  sessionManager: SessionManager;
  appearanceManager: AppearanceManager;
  associationManager: AppAssociationManager;
  executionContext: ExecutionContext;
}

const clone = <T>(value: T): T => structuredClone(value);

export function createControlPlaneApis({
  appCatalog,
  packageManager,
  daemonManager,
  userManager,
  sessionManager,
  appearanceManager,
  associationManager,
  executionContext,
}: Dependencies): EdenControlPlaneApis {
  const apps: EdenAppsApi = {
    list: (options) => {
      const user = sessionManager.getCurrentUser();
      if (!user) return [];
      return executionContext.run(
        { principal: { kind: "user", profile: user } },
        () => clone(appCatalog.list(options)),
      );
    },
    get: (appId) => {
      const app = appCatalog.get(appId);
      return app ? clone(app) : undefined;
    },
    getIcon: (appId) => appCatalog.getIcon(appId),
    getSize: (appId) => appCatalog.getSize(appId),
    getPackageInfo: async (sourcePath) =>
      clone(await packageManager.getPackageInfo(sourcePath)),
    install: async (sourcePath) =>
      clone(await packageManager.installApp(sourcePath)),
    uninstall: (appId) => packageManager.uninstallApp(appId),
    reload: (appId) => packageManager.reloadApp(appId),
    isHotReloadEnabled: (appId) => packageManager.isHotReloadEnabled(appId),
    toggleHotReload: (appId) => packageManager.toggleHotReload(appId),
    onChanged: (listener) => {
      const offInstalled = packageManager.on("installed", ({ manifest }) => {
        listener({ type: "upserted", manifest: clone(manifest) });
      });
      const offUninstalled = packageManager.on("uninstalled", ({ appId }) => {
        listener({ type: "uninstalled", appId });
      });
      return () => {
        offInstalled();
        offUninstalled();
      };
    },
  };

  const daemons: EdenDaemonsApi = {
    list: async () => clone(await daemonManager.list()),
    updateDefinition: (definition) =>
      daemonManager.updateDefinition(clone(definition)),
    setEnabled: (appId, enabled) => daemonManager.setEnabled(appId, enabled),
    start: (appId) => daemonManager.start(appId),
    stop: (appId) => daemonManager.stop(appId),
    restart: (appId) => daemonManager.restart(appId),
    onChanged: (listener) =>
      daemonManager.on("changed", ({ status }) => listener(clone(status))),
  };

  const users: EdenUsersApi = {
    list: async () => clone(await userManager.listUsers()),
    get: async (username) => {
      const user = await userManager.getUser(username);
      return user ? clone(user) : null;
    },
    create: async (input) => clone(await userManager.createUser(clone(input))),
    update: async (input) => {
      const user = await userManager.updateUser(clone(input));
      sessionManager.synchronizeUser(user);
      return clone(user);
    },
    delete: (username) => userManager.deleteUser(username),
    setPassword: async (username, password) => {
      const user = await userManager.setPassword(username, password);
      sessionManager.synchronizeUser(user);
    },
    getDefaultUsername: () => userManager.getDefaultUsername(),
    setDefaultUsername: (username) => userManager.setDefaultUsername(username),
  };

  const sessions: EdenSessionsApi = {
    current: () => {
      const user = sessionManager.getCurrentUser();
      return user ? clone(user) : null;
    },
    login: async (username, password) =>
      clone(await sessionManager.login(username, password)),
    logout: () => sessionManager.logout(),
    onChanged: (listener) =>
      sessionManager.on("changed", (change) => listener(clone(change))),
  };

  const appearance: EdenAppearanceApi = {
    getWallpaper: async () => clone(await appearanceManager.getWallpaper()),
    getPresets: () => clone(appearanceManager.getPresets()),
    setWallpaper: (config) => appearanceManager.setWallpaper(clone(config)),
    onChanged: (listener) =>
      appearanceManager.on("wallpaper-changed", (wallpaper) =>
        listener(clone(wallpaper)),
      ),
  };

  const associations: EdenAssociationsApi = {
    get: (key) => {
      const association = associationManager.get(key);
      return association ? clone(association) : undefined;
    },
    list: (options) => clone(associationManager.list(options)),
    set: (key, association) => associationManager.set(key, clone(association)),
    remove: (key) => associationManager.remove(key),
  };

  return { apps, daemons, users, sessions, appearance, associations };
}
