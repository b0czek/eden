import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { createControlPlaneApis } from "../api/control-plane-controllers";
import { createSdkContext } from "../api/sdk-context";
import { AppAssociations } from "../applications/app-associations/service";
import { Autostart } from "../applications/autostart/service";
import { Daemons } from "../applications/daemon/service";
import { Packages } from "../applications/packages/service";
import { ExecutionContext } from "../core/execution/context";
import { IpcTransport } from "../core/ipc/transport";
import { createOperationsSdkController } from "../core/operations/controller-sdk";
import { Operations } from "../core/operations/service";
import { Users } from "../core/user/service";
import { Appearance } from "../desktop/appearance/service";
import { Branding } from "../desktop/branding/service";
import { Keyboard } from "../desktop/keyboard/service";
import { Sessions } from "../desktop/session/service";
import { Views } from "../desktop/views/service";
import { Volumes } from "../platform/filesystem/volumes/service";
import { RuntimeEnvironment } from "./environment";
import { createFoundationWindow } from "./foundation-window";
import { connectRuntimeLifecycle } from "./integrations";
import { acquireDesktopLifecycle } from "./lifecycle";
import { inspectRuntimeServices } from "./services";

/** Assemble the host boundary after service acquisition and API registration. */
export const assembleDesktop = Effect.fn(function* () {
  const { config, paths, platform } = yield* RuntimeEnvironment;
  const operations = yield* Operations;
  const sdk = createSdkContext({
    execution: yield* ExecutionContext,
    operations,
  });
  const foundation = yield* createFoundationWindow({
    config,
    paths,
    platform,
    branding: yield* Branding,
    views: yield* Views,
    ipc: yield* IpcTransport,
    keyboard: yield* Keyboard,
    autostart: yield* Autostart,
  });

  yield* connectRuntimeLifecycle();

  const controlPlane = createControlPlaneApis({
    packages: yield* Packages,
    daemons: yield* Daemons,
    users: yield* Users,
    sessions: yield* Sessions,
    appearance: yield* Appearance,
    associations: yield* AppAssociations,
    volumes: yield* Volumes,
    sdk,
  });
  const operationsApi = createOperationsSdkController({
    operations,
    sdk,
  });
  const lifecycle = yield* acquireDesktopLifecycle(foundation);

  return {
    services: yield* inspectRuntimeServices,
    controlPlane,
    operationsApi,
    foundation,
    ...lifecycle,
  };
});

export type Desktop = Effect.Success<ReturnType<typeof assembleDesktop>>;
export const Desktop = Context.Service<"eden/Desktop", Desktop>("eden/Desktop");
