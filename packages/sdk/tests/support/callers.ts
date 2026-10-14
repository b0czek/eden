import type { EdenCreateUserInput } from "../../src/api/ControlPlaneApi";
import { PermissionRegistry } from "../../src/ipc";
import type { TestEden } from "./createTestEden";

export async function createTestCaller(
  eden: TestEden,
  appId: string,
  permissions: string[],
  userInput: Partial<EdenCreateUserInput> = {},
) {
  const user = await eden.runtime.users.create({
    username: "operator",
    name: "Operator",
    password: "password",
    grants: ["*"],
    ...userInput,
  });
  eden.runtime.resolve(PermissionRegistry).registerApp(appId, permissions);
  return {
    user,
    caller: { appId, principal: { kind: "user" as const, profile: user } },
  };
}
