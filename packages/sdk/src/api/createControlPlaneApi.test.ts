import type { RuntimeAppManifest, UserProfile } from "@edenapp/types";
import { createControlPlaneApis } from "./createControlPlaneApi";

const manifest = {
  id: "com.example.app",
  name: "Example",
  version: "1.0.0",
  isPrebuilt: false,
  isDevelopment: false,
  isCore: false,
  isRestricted: false,
  resolvedGrants: [],
} as unknown as RuntimeAppManifest;

const user: UserProfile = {
  username: "operator",
  name: "Operator",
  role: "standard",
  grants: [],
  createdAt: 1,
  updatedAt: 1,
};

const createDependencies = () => {
  const packageListeners = new Map<string, (payload: never) => void>();
  const daemonListeners = new Map<string, (payload: never) => void>();
  const sessionListeners = new Map<string, (payload: never) => void>();
  const appearanceListeners = new Map<string, (payload: never) => void>();
  return {
    appCatalog: {
      list: jest.fn(() => [manifest]),
      get: jest.fn(() => manifest),
      getIcon: jest.fn(async () => "data:image/png;base64,AA=="),
      getSize: jest.fn(async () => 42),
    },
    packageManager: {
      getPackageInfo: jest.fn(async () => ({ success: true, manifest })),
      installApp: jest.fn(async () => manifest),
      uninstallApp: jest.fn(async () => true),
      reloadApp: jest.fn(async () => undefined),
      isHotReloadEnabled: jest.fn(async () => false),
      toggleHotReload: jest.fn(async () => true),
      on: jest.fn((event: string, listener: (payload: never) => void) => {
        packageListeners.set(event, listener);
        return () => packageListeners.delete(event);
      }),
    },
    daemonManager: {
      list: jest.fn(async () => []),
      updateDefinition: jest.fn(async () => undefined),
      setEnabled: jest.fn(async () => undefined),
      start: jest.fn(async () => undefined),
      stop: jest.fn(async () => undefined),
      restart: jest.fn(async () => undefined),
      on: jest.fn((event: string, listener: (payload: never) => void) => {
        daemonListeners.set(event, listener);
        return () => daemonListeners.delete(event);
      }),
    },
    userManager: {
      listUsers: jest.fn(async () => [user]),
      getUser: jest.fn(async () => user),
      createUser: jest.fn(async () => user),
      updateUser: jest.fn(async () => user),
      deleteUser: jest.fn(async () => undefined),
      setPassword: jest.fn(async () => user),
      getDefaultUsername: jest.fn(() => "operator"),
      setDefaultUsername: jest.fn(async () => undefined),
    },
    sessionManager: {
      getCurrentUser: jest.fn(() => user),
      login: jest.fn(async () => user),
      logout: jest.fn(async () => undefined),
      synchronizeUser: jest.fn(),
      on: jest.fn((event: string, listener: (payload: never) => void) => {
        sessionListeners.set(event, listener);
        return () => sessionListeners.delete(event);
      }),
    },
    appearanceManager: {
      getWallpaper: jest.fn(async () => ({
        id: "midnight",
        name: "Midnight",
        type: "color" as const,
        value: "#000",
      })),
      getPresets: jest.fn(() => ({ solid: [], gradients: [] })),
      setWallpaper: jest.fn(async () => undefined),
      on: jest.fn((event: string, listener: (payload: never) => void) => {
        appearanceListeners.set(event, listener);
        return () => appearanceListeners.delete(event);
      }),
    },
    associationManager: {
      get: jest.fn(() => ({ appId: manifest.id, kind: "provider" })),
      list: jest.fn(() => ({})),
      set: jest.fn(async () => undefined),
      remove: jest.fn(async () => undefined),
    },
    executionContext: {
      run: jest.fn((_context, task: () => unknown) => task()),
    },
    packageListeners,
  };
};

describe("main-process control-plane API", () => {
  it("returns detached DTOs instead of internal manager state", () => {
    const dependencies = createDependencies();
    const api = createControlPlaneApis(dependencies as never);

    const listed = api.apps.list();
    listed[0].name = "Changed by host";

    expect(manifest.name).toBe("Example");
    expect(api.apps.get(manifest.id)).not.toBe(manifest);
    expect(dependencies.executionContext.run).toHaveBeenCalledWith(
      { principal: { kind: "user", profile: user } },
      expect.any(Function),
    );
  });

  it("routes user mutations through session synchronization", async () => {
    const dependencies = createDependencies();
    const api = createControlPlaneApis(dependencies as never);

    await api.users.update({ username: user.username, name: "Renamed" });
    await api.users.setPassword(user.username, "secret");

    expect(dependencies.sessionManager.synchronizeUser).toHaveBeenCalledTimes(
      2,
    );
  });

  it("exposes idempotent event unsubscription", () => {
    const dependencies = createDependencies();
    const api = createControlPlaneApis(dependencies as never);
    const listener = jest.fn();

    const unsubscribe = api.apps.onChanged(listener);
    dependencies.packageListeners.get("installed")?.({ manifest } as never);
    unsubscribe();
    unsubscribe();

    expect(listener).toHaveBeenCalledWith({
      type: "upserted",
      manifest: expect.objectContaining({ id: manifest.id }),
    });
    expect(dependencies.packageListeners.size).toBe(0);
  });
});
