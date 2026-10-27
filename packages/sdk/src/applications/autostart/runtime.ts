import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RuntimeEnvironment } from "../../runtime/environment";
import { createDevelopmentAutostart } from "./development";
import { AutostartConfig, DevelopmentAutostart } from "./ports";

export const AutostartPortsLive = Layer.effectContext(
  Effect.gen(function* () {
    const { config } = yield* RuntimeEnvironment;
    return Context.make(AutostartConfig, {
      development: !!config.development,
      loginAppId: config.loginAppId,
    }).pipe(
      Context.add(DevelopmentAutostart, createDevelopmentAutostart(config)),
    );
  }),
);
