import * as Effect from "effect/Effect";
import * as v from "valibot";
import type { EdenVolumesApi } from "../../api/control-plane";
import type { SdkContext } from "../../api/sdk-context";
import { VolumeEjectRejected, VolumeUnavailable } from "./errors";
import {
  volumeEjectArgsSchema,
  volumeIdSchema,
  volumeOptionsSchema,
  volumeRegistrationSchema,
} from "./schemas";
import type { Volumes } from "./service";

export function createVolumesSdkController({
  volumes,
  sdk,
}: {
  volumes: Volumes;
  sdk: SdkContext;
}): EdenVolumesApi {
  return {
    register: (input, options) =>
      sdk.effect(() => {
        const registration = v.parse(volumeRegistrationSchema, input);
        const parsedOptions = v.parse(volumeOptionsSchema, options);
        const preparedOptions = {
          ...parsedOptions,
          eject: parsedOptions.eject?.bind(options),
        };
        return Effect.map(
          volumes.register(registration, preparedOptions),
          structuredClone,
        );
      }),
    eject: (id) =>
      sdk.effect(() => {
        const args = v.parse(volumeEjectArgsSchema, { volume: id });
        return sdk.operation(
          "volume/eject",
          args,
          Effect.try({
            try: () => volumes.prepareEject(args.volume),
            catch: (cause) => {
              if (
                cause instanceof VolumeUnavailable ||
                cause instanceof VolumeEjectRejected
              )
                return cause;
              throw cause;
            },
          }),
        );
      }),
    unregister: (id) =>
      sdk.run(() => volumes.unregister(v.parse(volumeIdSchema, id))),
    list: () => sdk.run(() => structuredClone(volumes.list())),
    onChanged: (listener) =>
      sdk.subscribe(listener, (notify) =>
        volumes.changed.on(({ volumes: current }) => notify(current)),
      ),
  };
}
