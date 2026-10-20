import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { createControlPlaneApis } from "../api/control-plane-controllers";
import { createSdkContext } from "../api/sdk-context";
import { AppAssociations } from "../app-associations/service";
import { Appearance } from "../appearance/service";
import { Autostart } from "../autostart/service";
import { Branding } from "../branding/service";
import { Daemons } from "../daemon/service";
import { ExecutionContext } from "../execution/context";
import { Volumes } from "../filesystem/volumes";
import { IpcTransport } from "../ipc/transport";
import { Keyboard } from "../keyboard/service";
import { createOperationsSdkController } from "../operations/controller-sdk";
import { Operations } from "../operations/service";
import { Packages } from "../packages/service";
import { Sessions } from "../session/service";
import { Users } from "../user/service";
import { Views } from "../views/service";
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

export type RuntimeBundle = Effect.Success<ReturnType<typeof assembleDesktop>>;
export const Desktop = Context.Service<"eden/Desktop", RuntimeBundle>(
  "eden/Desktop",
);
