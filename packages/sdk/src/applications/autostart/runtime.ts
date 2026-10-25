import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RuntimeEnvironment } from "../../runtime/environment";
import { PackageCatalog } from "../packages/catalog";
import { Processes } from "../processes/service";
import { createDevelopmentAutostart } from "./development";
import {
  AutostartConfig,
  AutostartProcesses,
  DevelopmentAutostart,
} from "./ports";
import { createAutostartProcesses } from "./processes";

export const AutostartPortsLive = Layer.effectContext(
  Effect.gen(function* () {
    const { config } = yield* RuntimeEnvironment;
    return Context.make(AutostartConfig, {
      development: !!config.development,
      loginAppId: config.loginAppId,
    }).pipe(
      Context.add(
        AutostartProcesses,
        createAutostartProcesses(yield* Processes, yield* PackageCatalog),
      ),
      Context.add(DevelopmentAutostart, createDevelopmentAutostart(config)),
    );
  }),
);
