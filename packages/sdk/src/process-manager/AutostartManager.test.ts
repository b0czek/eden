import "reflect-metadata";

import type { EdenConfig, UserProfile } from "@edenapp/types";
import { ExecutionContext } from "../execution";
import type { SessionContext, SessionManager } from "../session";
import type { SettingsManager } from "../settings";
import { AutostartManager } from "./AutostartManager";
import type { ProcessManager } from "./ProcessManager";

describe("AutostartManager", () => {
  it("launches session apps with the committed user as execution principal", async () => {
    const profile: UserProfile = {
      username: "operator",
      name: "Operator",
      role: "standard",
      grants: ["apps/launch/com.eden.eveshell"],
      createdAt: 1,
      updatedAt: 1,
    };
    const executionContext = new ExecutionContext({} as EdenConfig);
    const launchApp = jest.fn(async () => {
      expect(executionContext.getPrincipal()).toEqual({
        kind: "user",
        profile,
      });
    });
    const manager = new AutostartManager(
      {} as EdenConfig,
      {
        getInstalledManifest: () => ({
          id: "com.eden.eveshell",
          frontend: { entry: "index.html" },
        }),
        getAppInstance: () => undefined,
        launchApp,
      } as unknown as ProcessManager,
      {
        list: jest.fn().mockResolvedValue(["autostart.com.eden.eveshell"]),
        get: jest.fn().mockResolvedValue("true"),
      } as unknown as SettingsManager,
      { getCurrentUser: () => profile } as unknown as SessionContext,
      executionContext,
      { on: jest.fn() } as unknown as SessionManager,
    );

    await (
      manager as unknown as { launchSessionApps(): Promise<void> }
    ).launchSessionApps();

    expect(launchApp).toHaveBeenCalledWith("com.eden.eveshell");
  });
});
