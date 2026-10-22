import * as Effect from "effect/Effect";
import {
  type CommandCallerContext,
  principalHasGrant,
} from "../execution/context";
import { CommandGrantDenied, CommandPermissionDenied } from "../ipc/errors";
import type { Permissions } from "../ipc/permissions";
import { SettingsCallerIdentityError } from "./errors";
import type { Settings } from "./service";

type Setting = { appId: string; key: string };
type ReadPermission = "rw" | "superuser";

/** One read decision for app commands and change-event recipients. */
export function createSettingsReadAccess(
  settings: Settings,
  permissions: Permissions,
) {
  function readError(
    { appId, key }: Setting,
    reader: CommandCallerContext,
    permission: ReadPermission,
  ) {
    const readerAppId = reader.appId;
    if (!readerAppId && permission === "rw")
      return new SettingsCallerIdentityError();
    const hasGrant = (grant: string) =>
      principalHasGrant(reader.principal, grant);
    const requiredPermission = `settings/${permission}`;
    if (
      readerAppId &&
      !permissions.hasPermission(readerAppId, requiredPermission, hasGrant)
    ) {
      const command = permission === "rw" ? "settings/get" : "settings/get/su";
      const grantKeys = permissions.getRequiredGrantKeys(
        readerAppId,
        requiredPermission,
      );
      return grantKeys.length
        ? new CommandGrantDenied({ command, grantKeys, appId: readerAppId })
        : new CommandPermissionDenied({
            command,
            permission: requiredPermission,
            appId: readerAppId,
          });
    }
    return settings.readAccessError(
      appId,
      key,
      readerAppId,
      hasGrant,
      permission === "superuser",
    );
  }

  return {
    assertReadable: (
      setting: Setting,
      reader: CommandCallerContext,
      permission: ReadPermission = "rw",
    ) =>
      Effect.suspend(() => {
        const error = readError(setting, reader, permission);
        return error ? Effect.fail(error) : Effect.void;
      }),
    canReadChange: (setting: Setting, reader: CommandCallerContext): boolean =>
      !!reader.appId &&
      (!readError(setting, reader, "rw") ||
        !readError(setting, reader, "superuser")),
  };
}
