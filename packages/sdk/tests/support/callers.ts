import * as Effect from "effect/Effect";
import type { EdenCreateUserInput } from "../../src/api/control-plane";
import {
  ExecutionContext,
  ExecutionContextLive,
} from "../../src/execution/context";
import { Permissions } from "../../src/ipc";
import { RuntimeConfig } from "../../src/runtime/inputs";
import type { TestEden } from "./createTestEden";
import { buildService } from "./effect-runtime";

/** Scoped caller context with a controlled grant policy for settings fixtures. */
export function createTestExecutionContext(
  hasGrant: (grant: string) => boolean,
) {
  return Effect.map(
    buildService(ExecutionContext, ExecutionContextLive).pipe(
      Effect.provideService(RuntimeConfig, {}),
    ),
    (execution) => ({ ...execution, hasGrant }),
  );
}

export async function createTestCaller(
  eden: TestEden,
  appId: string,
  permissions: string[],
  userInput: Partial<EdenCreateUserInput> = {},
) {
  const user = await eden.runtime.effects.run(
    eden.runtime.users.create({
      username: "operator",
      name: "Operator",
      password: "password",
      grants: ["*"],
      ...userInput,
    }),
  );
  eden.runtime.services.permissions.registerApp(appId, permissions);
  return {
    user,
    caller: { appId, principal: { kind: "user" as const, profile: user } },
  };
}
