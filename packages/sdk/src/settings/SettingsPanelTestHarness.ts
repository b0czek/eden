import "reflect-metadata";
import type {
  RuntimeAppManifest,
  SettingsPanelDefinition,
  UserProfile,
} from "@edenapp/types";
import type { PackageCatalog } from "../package-manager/PackageCatalog";
import type { ExecutionContext } from "../execution";
import type { CommandRegistry, IPCBridge } from "../ipc";
import type { SessionContext } from "../session";
import type { SettingsManager } from "./SettingsManager";
import { SettingsPanelManager } from "./SettingsPanelManager";

export const panelUser = (
  grants: string[],
  overrides: Partial<UserProfile> = {},
): UserProfile => ({
  username: "alice",
  name: "Alice",
  role: "standard",
  grants,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

export const panelDefinition = (
  overrides: Partial<SettingsPanelDefinition> = {},
): SettingsPanelDefinition => ({
  id: "vendor.network",
  title: { en: "Network" },
  grant: "panels/network",
  sections: [
    {
      id: "main",
      controls: [
        {
          kind: "toggle",
          id: "enabled",
          label: "Enabled",
          stateKey: "enabled",
          actionId: "toggle",
        },
      ],
    },
  ],
  actions: [
    {
      id: "toggle",
      input: {
        type: "object",
        properties: { value: { type: "boolean", required: true } },
        additionalProperties: false,
      },
    },
  ],
  ...overrides,
});

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
