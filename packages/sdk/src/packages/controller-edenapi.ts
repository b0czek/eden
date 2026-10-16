import * as Effect from "effect/Effect";
import * as v from "valibot";
import {
  command,
  defineController,
  operation,
} from "../controllers/controller";
import {
  filesystemLocationArgsSchema,
  filesystemLocationSchema,
} from "../filesystem/location-schema";
import { packageIdSchema, packageInstallOptionsSchema } from "./schemas";
import type { Packages } from "./service";

const packageArgs = v.object({ packageId: packageIdSchema });
const installPackageArgs = v.object({
  source: filesystemLocationSchema,
  replace: packageInstallOptionsSchema.entries.replace,
});
const listAppsArgs = v.object({
  showHidden: v.optional(v.boolean()),
  showRestricted: v.optional(v.boolean()),
});

export function createPackageController(packages: Packages) {
  return defineController("package", {
    commands: {
      install: command({
        permission: "manage",
        mode: "operation",
        input: installPackageArgs,
        handle: ({ source, replace }) =>
          packages.prepareInstallPackage(source, replace === true),
      }),
      uninstall: operation({
        permission: "manage",
        input: packageArgs,
        prepare:
          ({ packageId }) =>
          (reporter) =>
            packages.uninstallPackage(packageId, reporter),
      }),
      list: command({
        permission: "read",
        input: listAppsArgs,
        handle: (args) =>
          packages.listInstalledPackages({ kind: "app", ...args }),
      }),
      self: command({
        handle: (_args, caller) => {
          if (!caller.appId)
            throw new Error("An authenticated app is required");
          const info = packages.getInstalledPackageInfo(
            caller.appId,
            caller.webContentsId,
          );
          if (info?.manifest.kind !== "app")
            throw new Error(`App ${caller.appId} is not installed`);
          return info;
        },
      }),
      get: command({
        permission: "read",
        input: packageArgs,
        handle: ({ packageId }, caller) => {
          const info = packages.getInstalledPackageInfo(
            packageId,
            caller.webContentsId,
          );
          if (!info) throw new Error(`Package ${packageId} is not installed`);
          return info;
        },
      }),
      "toggle-hot-reload": command({
        permission: "manage",
        input: packageArgs,
        handle: ({ packageId }) =>
          Effect.map(packages.toggleHotReload(packageId), (enabled) => ({
            enabled,
          })),
      }),
      "is-hot-reload-enabled": command({
        permission: "read",
        input: packageArgs,
        handle: ({ packageId }) =>
          Effect.map(packages.isHotReloadEnabled(packageId), (enabled) => ({
            enabled,
          })),
      }),
      "get-icon": command({
        permission: "read",
        input: packageArgs,
        handle: ({ packageId }) =>
          Effect.map(packages.getPackageIcon(packageId), (icon) => ({ icon })),
      }),
      "get-info": command({
        permission: "read",
        input: filesystemLocationArgsSchema,
        handle: ({ location }) => packages.getPackageInfo(location),
      }),
      "get-size": command({
        permission: "read",
        input: packageArgs,
        handle: ({ packageId }) =>
          Effect.map(packages.getPackageSize(packageId), (size) => ({ size })),
      }),
    },
    events: {
      installed: packages.installed,
      uninstalled: packages.uninstalled,
    },
  });
}
