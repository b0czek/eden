import type { AppAssociationManager } from "../app-associations";
import type { AppearanceManager } from "../appearance/AppearanceManager";
import type { DaemonManager } from "../daemon";
import type { VolumeManager } from "../filesystem/VolumeManager";
import type { OperationManager } from "../operations/OperationManager";
import { operationTask } from "../operations/OperationTask";
import type { PackageManager } from "../package-manager";
import type { SessionManager } from "../session";
import type { UserManager } from "../user";
import type {
  EdenAppearanceApi,
  EdenAssociationsApi,
  EdenDaemonsApi,
  EdenPackagesApi,
  EdenSessionsApi,
  EdenUsersApi,
  EdenVolumesApi,
} from "./ControlPlaneApi";

export interface EdenControlPlaneApis {
  packages: EdenPackagesApi;
  daemons: EdenDaemonsApi;
  users: EdenUsersApi;
  sessions: EdenSessionsApi;
  appearance: EdenAppearanceApi;
  associations: EdenAssociationsApi;
  volumes: EdenVolumesApi;
}

interface Dependencies {
  packageManager: PackageManager;
  daemonManager: DaemonManager;
  userManager: UserManager;
  sessionManager: SessionManager;
  appearanceManager: AppearanceManager;
  associationManager: AppAssociationManager;
  volumeManager: VolumeManager;
  operationManager: OperationManager;
}

const clone = <T>(value: T): T => structuredClone(value);

export function createControlPlaneApis({
  packageManager,
  daemonManager,
  userManager,
  sessionManager,
  appearanceManager,
  associationManager,
  volumeManager,
  operationManager,
}: Dependencies): EdenControlPlaneApis {
  const packages: EdenPackagesApi = {
    list: (options) =>
      clone(
        packageManager.listInstalledPackages({
          ...options,
          showRestricted: true,
        }),
      ),
    get: (packageId) =>
      clone(packageManager.getInstalledPackageInfo(packageId)),
    getIcon: (packageId) => packageManager.getPackageIcon(packageId),
    getSize: (packageId) => packageManager.getPackageSize(packageId),
    inspect: async (sourcePath) =>
      clone(await packageManager.getPackageInfoFromHostPath(sourcePath)),
    install: async (sourcePath, options) =>
      clone(
        await operationManager.runHost(
          "package/install",
          { sourcePath, replace: options?.replace === true },
          () =>
            operationTask((reporter) =>
              packageManager.installPackageFromHostPath(
                sourcePath,
                options?.replace === true,
                reporter,
              ),
            ),
        ),
      ),
    uninstall: (packageId) =>
      operationManager.runHost("package/uninstall", { packageId }, () =>
        operationTask((reporter) =>
          packageManager.uninstallPackage(packageId, reporter),
        ),
      ),
    reload: (packageId) => packageManager.reloadPackage(packageId),
    isHotReloadEnabled: (packageId) =>
      packageManager.isHotReloadEnabled(packageId),
    toggleHotReload: (packageId) => packageManager.toggleHotReload(packageId),
    onChanged: (listener) => {
      const offs = [
        packageManager.on("installed", ({ manifest }) =>
          listener({ type: "upserted", manifest: clone(manifest) }),
        ),
        packageManager.on("uninstalled", (change) =>
          listener({ type: "uninstalled", ...clone(change) }),
        ),
      ];
      return () => {
        for (const off of offs) off();
      };
    },
  };

  const daemons: EdenDaemonsApi = {
    list: async () => clone(await daemonManager.list()),
    updateDefinition: (definition) =>
      daemonManager.updateDefinition(clone(definition)),
    setEnabled: (appId, enabled) => daemonManager.setEnabled(appId, enabled),
    start: async (appId) => {
      await operationManager.runHost("daemon/start", { appId }, () =>
        operationTask(async (reporter) => {
          reporter.update("starting-daemon");
          await daemonManager.start(appId);
          return { success: true };
        }),
      );
    },
    stop: async (appId) => {
      await operationManager.runHost("daemon/stop", { appId }, () =>
        operationTask(async (reporter) => {
          reporter.update("stopping-daemon");
          await daemonManager.stop(appId);
          return { success: true };
        }),
      );
    },
    restart: async (appId) => {
      await operationManager.runHost("daemon/restart", { appId }, () =>
        operationTask(async (reporter) => {
          reporter.update("restarting-daemon");
          await daemonManager.restart(appId);
          return { success: true };
        }),
      );
    },
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
    login: async (username, password) => {
      const result = await operationManager.runHost(
        "session/login",
        { username },
        () =>
          operationTask(
            async () => ({
              success: true,
              user: await sessionManager.login(username, password),
            }),
            { transition: "session" },
          ),
      );
      return clone(result.user);
    },
    logout: async () => {
      await operationManager.runHost("session/logout", {}, () =>
        operationTask(
          async () => {
            await sessionManager.logout();
            return { success: true };
          },
          { transition: "session" },
        ),
      );
    },
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

  const volumes: EdenVolumesApi = {
    register: (input, options) => volumeManager.register(clone(input), options),
    eject: (id) =>
      operationManager.runHost("volume/eject", { volume: id }, () =>
        volumeManager.prepareEject(id),
      ),
    unregister: (id) => volumeManager.unregister(id),
    list: () => volumeManager.list(),
    onChanged: (listener) =>
      volumeManager.on("changed", ({ volumes }) => listener(clone(volumes))),
  };

  return {
    volumes,
    packages,
    daemons,
    users,
    sessions,
    appearance,
    associations,
  };
}
