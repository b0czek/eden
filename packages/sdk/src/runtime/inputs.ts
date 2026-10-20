import * as Context from "effect/Context";
import type { EdenConfig } from "../api/config";
export const RuntimeConfig = Context.Service<"eden/RuntimeConfig", EdenConfig>(
  "eden/RuntimeConfig",
);
export const AppsDirectory = Context.Service<"eden/AppsDirectory", string>(
  "eden/AppsDirectory",
);
export const UserDirectory = Context.Service<"eden/UserDirectory", string>(
  "eden/UserDirectory",
);
export const DistPath = Context.Service<"eden/DistPath", string>(
  "eden/DistPath",
);
