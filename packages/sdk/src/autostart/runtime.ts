import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ExecutionContext } from "../execution/context";
import { Processes } from "../processes/service";
import { RuntimeEnvironment } from "../runtime/environment";
import { createDevelopmentAutostart } from "./development";
import { AutostartProcesses, DevelopmentAutostart } from "./ports";
import { createAutostartProcesses } from "./processes";
import { AutostartDevelopment, AutostartLoginAppId } from "./service";

export const AutostartPortsLive = Layer.effectContext(
  Effect.gen(function* () {
    const { config } = yield* RuntimeEnvironment;
    return Context.make(AutostartDevelopment, !!config.development).pipe(
      Context.add(AutostartLoginAppId, config.loginAppId),
      Context.add(
        AutostartProcesses,
        createAutostartProcesses(yield* Processes, yield* ExecutionContext),
      ),
      Context.add(DevelopmentAutostart, createDevelopmentAutostart(config)),
    );
  }),
);
