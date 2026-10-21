import * as path from "node:path";
import * as Effect from "effect/Effect";
import { syncIo } from "../filesystem/native-sync";
import { log } from "../logging/logger";
import type { KeyboardAssets } from "./ports";

/** The keyboard renderer and preload belong to the SDK's native asset directory. */
export function createKeyboardAssets(
  directory = path.join(__dirname, ".."),
): KeyboardAssets {
  const frontendPath = path.join(directory, "keyboard-ui/index.html");
  const preloadPath = path.join(directory, "foundation/keyboard-preload.js");
  return {
    frontendPath,
    preloadPath,
    available: Effect.sync(() => {
      if (!syncIo.exists(frontendPath)) {
        log.error(
          `Keyboard frontend not found at ${frontendPath}. Build the SDK apps first.`,
        );
        return false;
      }
      if (!syncIo.exists(preloadPath)) {
        log.error(
          `Keyboard preload not found at ${preloadPath}. Build/copy SDK foundation assets first.`,
        );
        return false;
      }
      return true;
    }),
  };
}
