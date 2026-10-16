import * as v from "valibot";
import type { EdenVolumesApi } from "../api/control-plane";
import type { SdkContext } from "../api/sdk-context";
import {
  volumeEjectArgsSchema,
  volumeIdSchema,
  volumeOptionsSchema,
  volumeRegistrationSchema,
} from "./volume-schemas";
import type { Volumes } from "./volumes";

export function createVolumesSdkController({
  volumes,
  sdk,
}: {
  volumes: Volumes;
  sdk: SdkContext;
}): EdenVolumesApi {
  return {
    register: async (input, options) =>
      sdk.run(async () => {
        const registration = v.parse(
          volumeRegistrationSchema,
          structuredClone(input),
        );
        const parsedOptions = v.parse(volumeOptionsSchema, options);
        // Retain the callback's original owner while snapshotting grouping metadata.
        const preparedOptions = {
          ...parsedOptions,
          eject: parsedOptions.eject?.bind(options),
        };
        return structuredClone(
          await sdk.effect(volumes.register(registration, preparedOptions)),
        );
      }),
    eject: async (id) =>
      sdk.run(() => {
        const args = v.parse(volumeEjectArgsSchema, { volume: id });
        return sdk.operation("volume/eject", args, () =>
          volumes.prepareEject(args.volume),
        );
      }),
    unregister: (id) =>
      sdk.run(() => volumes.unregister(v.parse(volumeIdSchema, id))),
    list: () => sdk.run(() => structuredClone(volumes.list())),
    onChanged: (listener) =>
      sdk.run(() => {
        v.parse(v.function(), listener);
        const stop = volumes.changed.on(({ volumes: current }) =>
          sdk.run(() => listener(structuredClone(current))),
        );
        return () => sdk.run(stop);
      }),
  };
}
