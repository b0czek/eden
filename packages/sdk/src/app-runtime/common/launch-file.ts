import type { FilesystemLocation } from "@edenapp/types";

export function parseLaunchFile(
  args: string[],
): FilesystemLocation | undefined {
  const argument = args.find((arg) => arg.startsWith("--eden-file="));
  if (!argument) return undefined;
  const value: unknown = JSON.parse(argument.slice("--eden-file=".length));
  if (
    !value ||
    typeof value !== "object" ||
    !("volume" in value) ||
    !("path" in value) ||
    typeof value.volume !== "string" ||
    !value.volume ||
    typeof value.path !== "string"
  ) {
    throw new Error("Invalid file launch location");
  }
  return { volume: value.volume, path: value.path };
}
