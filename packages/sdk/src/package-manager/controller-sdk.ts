import * as v from "valibot";
import type { EdenPackagesApi } from "../api/ControlPlaneApi";
import type { SdkContext } from "../api/sdk-context";
import { operationTask } from "../operations/OperationTask";
import type { PackageManager } from "./PackageManager";
import {
  packageHostPathSchema,
  packageIdSchema,
  packageInstallOptionsSchema,
  packageListOptionsSchema,
} from "./schemas";

const clone = <A>(value: A): A => structuredClone(value);

export function createPackagesSdkController({
  packages,
  sdk,
}: {
  packages: PackageManager;
  sdk: SdkContext;
}): EdenPackagesApi {
  return {
    list: (options) =>
      sdk.run(() => {
        const input = v.parse(
          v.optional(packageListOptionsSchema, {}),
          options,
        );
        return clone(
          packages.listInstalledPackages({ ...input, showRestricted: true }),
        );
      }),
    get: (packageId) =>
      sdk.run(() =>
        clone(
          packages.getInstalledPackageInfo(v.parse(packageIdSchema, packageId)),
        ),
      ),
    getIcon: async (packageId) =>
      sdk.run(() =>
        sdk.effect(
          packages.getPackageIcon(v.parse(packageIdSchema, packageId)),
        ),
      ),
    getSize: async (packageId) =>
      sdk.run(() =>
        sdk.effect(
          packages.getPackageSize(v.parse(packageIdSchema, packageId)),
        ),
      ),
    inspect: async (sourcePath) =>
      sdk.run(async () => {
        const input = v.parse(packageHostPathSchema, sourcePath);
        return clone(
          await sdk.effect(packages.getPackageInfoFromHostPath(input)),
        );
      }),
    install: async (sourcePath, options) =>
      sdk.run(async () => {
        const input = v.parse(packageHostPathSchema, sourcePath);
        const { replace } = v.parse(
          v.optional(packageInstallOptionsSchema, {}),
          options,
        );
        return clone(
          await sdk.operation(
            "package/install",
            { sourcePath: input, replace: replace === true },
            () =>
              operationTask((reporter) =>
                packages.installPackageFromHostPath(
                  input,
                  replace === true,
                  reporter,
                ),
              ),
          ),
        );
      }),
    uninstall: async (packageId) =>
      sdk.run(() => {
        const input = v.parse(packageIdSchema, packageId);
        return sdk.operation("package/uninstall", { packageId: input }, () =>
          operationTask((reporter) =>
            packages.uninstallPackage(input, reporter),
          ),
        );
      }),
    reload: async (packageId) =>
      sdk.run(() =>
        sdk.effect(packages.reloadPackage(v.parse(packageIdSchema, packageId))),
      ),
    isHotReloadEnabled: async (packageId) =>
      sdk.run(() =>
        sdk.effect(
          packages.isHotReloadEnabled(v.parse(packageIdSchema, packageId)),
        ),
      ),
    toggleHotReload: async (packageId) =>
      sdk.run(() =>
        sdk.effect(
          packages.toggleHotReload(v.parse(packageIdSchema, packageId)),
        ),
      ),
    onChanged: (listener) =>
      sdk.run(() => {
        v.parse(v.function(), listener);
        const offs = [
          packages.installed.on(({ manifest }) =>
            sdk.run(() =>
              listener({ type: "upserted", manifest: clone(manifest) }),
            ),
          ),
          packages.uninstalled.on((change) =>
            sdk.run(() => listener({ type: "uninstalled", ...clone(change) })),
          ),
        ];
        return () => {
          for (const off of offs) off();
        };
      }),
  };
}
