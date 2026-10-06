import type { FilesystemLocation } from "@edenapp/types";

export interface AppLaunchContext {
  appId: string;
  args: string[];
  file?: FilesystemLocation;
}

const LAUNCH_ARGUMENT_PREFIX = "--eden-launch=";

export function encodeLaunchContext(context: AppLaunchContext): string[] {
  return [`${LAUNCH_ARGUMENT_PREFIX}${JSON.stringify(context)}`];
}

export function decodeLaunchContext(argv: string[]): AppLaunchContext {
  const argument = argv.find((arg) => arg.startsWith(LAUNCH_ARGUMENT_PREFIX));
  if (!argument) throw new Error("Missing app launch context");

  const value: unknown = JSON.parse(
    argument.slice(LAUNCH_ARGUMENT_PREFIX.length),
  );
  if (
    !value ||
    typeof value !== "object" ||
    !("appId" in value) ||
    typeof value.appId !== "string" ||
    !value.appId ||
    !("args" in value) ||
    !Array.isArray(value.args) ||
    !value.args.every((arg) => typeof arg === "string")
  ) {
    throw new Error("Invalid app launch context");
  }

  let file: FilesystemLocation | undefined;
  if ("file" in value && value.file !== undefined) {
    const location = value.file;
    if (
      !location ||
      typeof location !== "object" ||
      !("volume" in location) ||
      typeof location.volume !== "string" ||
      !location.volume ||
      !("path" in location) ||
      typeof location.path !== "string"
    ) {
      throw new Error("Invalid file launch location");
    }
    file = { volume: location.volume, path: location.path };
  }

  return { appId: value.appId, args: value.args, file };
}
