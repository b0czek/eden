import type { RuntimeAppManifest, UserProfile } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { createExecutionContext } from "../../../src/execution/ExecutionContext";
import type { SessionContext } from "../../../src/session/SessionContext";
import { createSettingsPanelManager } from "../../../src/settings/SettingsPanelManager";
import { panelUser } from "./panels";

export function createSettingsPanelHarness(
  initialUser = panelUser(["panels/network"]),
) {
  let currentUser: UserProfile | null = initialUser;
  let sessionId = "session-1";
  const notify = jest.fn();
  const settings = {
    get: jest.fn<Effect.Effect<string | undefined, Error>, [string, string]>(
      () => Effect.succeed(undefined),
    ),
    set: jest.fn<Effect.Effect<void, Error>, [string, string, string]>(
      () => Effect.void,
    ),
  };
  const catalog = {
    allApps: jest.fn<RuntimeAppManifest[], []>(() => []),
    getIcon: jest.fn<Effect.Effect<string | undefined>, [string]>(() =>
      Effect.succeed(undefined),
    ),
  };
  const execution = createExecutionContext({ config: {} });
  const manager = createSettingsPanelManager({
    settingsManager: settings,
    packageCatalog: catalog,
    sessionContext: {
      getCurrentUser: () =>
        currentUser
          ? { ...currentUser, grants: [...currentUser.grants] }
          : null,
      getSessionId: () => sessionId,
    } as SessionContext,
    executionContext: execution,
  });
  manager.changed.on(notify);
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
