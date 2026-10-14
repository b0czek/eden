import { panelUser } from "./panels";
import "reflect-metadata";
import type { RuntimeAppManifest, UserProfile } from "@edenapp/types";
import type { ExecutionContext } from "../../../src/execution";
import type { CommandRegistry, IPCBridge } from "../../../src/ipc";
import type { PackageCatalog } from "../../../src/package-manager/PackageCatalog";
import type { SessionContext } from "../../../src/session";
import type { SettingsManager } from "../../../src/settings/SettingsManager";
import { SettingsPanelManager } from "../../../src/settings/SettingsPanelManager";

export function createSettingsPanelHarness(
  initialUser = panelUser(["panels/network"]),
) {
  let currentUser: UserProfile | null = initialUser;
  let sessionId = "session-1";
  const notify = jest.fn();
  const settings = {
    get: jest.fn<Promise<string | undefined>, [string, string]>(
      async () => undefined,
    ),
    set: jest.fn<Promise<void>, [string, string, string]>(
      async () => undefined,
    ),
    listApps: jest.fn<Promise<string[]>, [string, boolean?]>(async () => []),
  };
  const catalog = {
    allApps: jest.fn<RuntimeAppManifest[], []>(() => []),
    listApps: jest.fn<RuntimeAppManifest[], [{ showHidden?: boolean }]>(
      () => [],
    ),
    getIcon: jest.fn<Promise<string | undefined>, [string]>(
      async () => undefined,
    ),
    getSize: jest.fn<Promise<number | undefined>, [string]>(
      async () => undefined,
    ),
  };
  const execution = {
    run: jest.fn((_context, task: () => unknown) => task()),
  };
  const manager = new SettingsPanelManager(
    { eventSubscribers: { notify } } as unknown as IPCBridge,
    { registerManager: jest.fn() } as unknown as CommandRegistry,
    settings as unknown as SettingsManager,
    catalog as unknown as PackageCatalog,
    {
      getCurrentUser: () =>
        currentUser
          ? { ...currentUser, grants: [...currentUser.grants] }
          : null,
      getSessionId: () => sessionId,
    } as unknown as SessionContext,
    execution as unknown as ExecutionContext,
  );
  return {
    manager,
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
