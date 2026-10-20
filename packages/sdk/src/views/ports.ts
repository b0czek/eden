import * as Context from "effect/Context";
import type { Settings } from "../settings/service";

export const ViewsSettings = Context.Service<
  "eden/ViewsSettings",
  Pick<Settings, "get" | "changed">
>("eden/ViewsSettings");
