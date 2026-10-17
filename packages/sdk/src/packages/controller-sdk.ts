import * as Effect from "effect/Effect";
import * as v from "valibot";
import type { EdenPackagesApi } from "../api/control-plane";
import type { SdkContext } from "../api/sdk-context";
import { operationTask } from "../operations/task";
import {
  packageHostPathSchema,
  packageIdSchema,
  packageInstallOptionsSchema,
  packageListOptionsSchema,
} from "./schemas";
import type { Packages } from "./service";

const clone = <A>(value: A): A => structuredClone(value);

export function createPackagesSdkController({
  packages,
  sdk,
}: {
  packages: Packages;
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
    getIcon: (packageId) =>
      sdk.effect(() =>
        packages.getPackageIcon(v.parse(packageIdSchema, packageId)),
      ),
    getSize: (packageId) =>
      sdk.effect(() =>
        packages.getPackageSize(v.parse(packageIdSchema, packageId)),
      ),
    inspect: (sourcePath) =>
      sdk.effect(() =>
        Effect.map(
          packages.getPackageInfoFromHostPath(
            v.parse(packageHostPathSchema, sourcePath),
          ),
          clone,
        ),
      ),
    install: (sourcePath, options) =>
      sdk.effect(() => {
        const input = v.parse(packageHostPathSchema, sourcePath);
        const { replace } = v.parse(
          v.optional(packageInstallOptionsSchema, {}),
          options,
        );
        return Effect.map(
          sdk.operation(
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
          clone,
        );
      }),
    uninstall: (packageId) =>
      sdk.effect(() => {
        const input = v.parse(packageIdSchema, packageId);
        return sdk.operation("package/uninstall", { packageId: input }, () =>
          operationTask((reporter) =>
            packages.uninstallPackage(input, reporter),
          ),
        );
      }),
    reload: (packageId) =>
      sdk.effect(() =>
        packages.reloadPackage(v.parse(packageIdSchema, packageId)),
      ),
    isHotReloadEnabled: (packageId) =>
      sdk.effect(() =>
        packages.isHotReloadEnabled(v.parse(packageIdSchema, packageId)),
      ),
    toggleHotReload: (packageId) =>
      sdk.effect(() =>
        packages.toggleHotReload(v.parse(packageIdSchema, packageId)),
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
