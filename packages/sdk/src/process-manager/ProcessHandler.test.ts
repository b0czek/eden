import "reflect-metadata";

import type { EdenConfig, UserProfile } from "@edenapp/types";
import { ExecutionContext } from "../execution";
import { ProcessHandler } from "./ProcessHandler";
import type { ProcessManager } from "./ProcessManager";

const user = (
  username: string,
  role: UserProfile["role"] = "standard",
): UserProfile => ({
  username,
  name: username,
  role,
  grants: [],
  createdAt: 1,
  updatedAt: 1,
});

describe("ProcessHandler stop authorization", () => {
  const appId = "com.example.target";
  let stopApp: jest.Mock;
  let executionContext: ExecutionContext;
  let handler: ProcessHandler;

  beforeEach(() => {
    stopApp = jest.fn().mockResolvedValue(undefined);
    executionContext = new ExecutionContext({} as EdenConfig);
    handler = new ProcessHandler(
      {
        getAppInstance: () => ({
          principal: { kind: "user", username: "alice" },
        }),
        stopApp,
      } as unknown as ProcessManager,
      executionContext,
    );
  });

  it("allows a user to stop a process with the same principal", async () => {
    await expect(
      executionContext.run(
        { principal: { kind: "user", profile: user("alice") } },
        () => handler.handleStopApp({ appId }),
      ),
    ).resolves.toEqual({ success: true });
  });

  it("rejects a user stopping another principal's process", async () => {
    await expect(
      executionContext.run(
        { principal: { kind: "user", profile: user("bob") } },
        () => handler.handleStopApp({ appId }),
      ),
    ).rejects.toThrow(`User cannot stop process ${appId}`);
    expect(stopApp).not.toHaveBeenCalled();
  });

  it.each([
    { principal: { kind: "system" as const } },
    {
      principal: {
        kind: "user" as const,
        profile: user("vendor", "vendor"),
      },
    },
  ])("allows system and vendor authority", async (context) => {
    await expect(
      executionContext.run(context, () => handler.handleStopApp({ appId })),
    ).resolves.toEqual({ success: true });
  });
});
