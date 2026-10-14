import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FilesystemVolumeRegistration } from "@edenapp/types";
import type {
  EdenCreateUserInput,
  EdenVolumeOptions,
} from "../../src/api/ControlPlaneApi";
import { PermissionRegistry } from "../../src/ipc";
import type { TestEden } from "./createTestEden";

export async function createFilesystemCaller(
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

export async function registerTestVolume(
  eden: TestEden,
  input: Omit<FilesystemVolumeRegistration, "rootPath">,
  options: EdenVolumeOptions = {},
) {
  const rootPath = path.join(eden.paths.root, input.id);
  await fs.mkdir(rootPath, { recursive: true });
  await eden.runtime.volumes.register({ ...input, rootPath }, options);
  return rootPath;
}
