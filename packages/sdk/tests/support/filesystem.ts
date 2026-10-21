import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FilesystemVolumeRegistration } from "@edenapp/types";
import type { EdenVolumeOptions } from "../../src/api/control-plane";
import type { TestEden } from "./create-test-eden";

export async function registerTestVolume(
  eden: TestEden,
  input: Omit<FilesystemVolumeRegistration, "rootPath">,
  options: EdenVolumeOptions = {},
) {
  const rootPath = path.join(eden.paths.root, input.id);
  await fs.mkdir(rootPath, { recursive: true });
  await eden.runtime.effects.run(
    eden.runtime.volumes.register({ ...input, rootPath }, options),
  );
  return rootPath;
}
