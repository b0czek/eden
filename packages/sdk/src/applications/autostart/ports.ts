import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface AutostartConfig {
  readonly development: boolean;
  readonly loginAppId?: string;
}
export const AutostartConfig = Context.Service<
  "eden/AutostartConfig",
  AutostartConfig
>("eden/AutostartConfig");

export interface DevelopmentAutostart {
  readonly apps: Effect.Effect<
    readonly { id: string; launchOnStart: boolean }[]
  >;
}
export const DevelopmentAutostart = Context.Service<
  "eden/DevelopmentAutostart",
  DevelopmentAutostart
>("eden/DevelopmentAutostart");
