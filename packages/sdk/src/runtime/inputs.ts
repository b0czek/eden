import * as Context from "effect/Context";
import type { EdenConfig } from "../api/config";
export const RuntimeConfig = Context.Service<"eden/RuntimeConfig", EdenConfig>(
  "eden/RuntimeConfig",
);
export const AppsDirectory = Context.Service<"eden/AppsDirectory", string>(
  "eden/AppsDirectory",
);
export const HomeDirectory = Context.Service<"eden/HomeDirectory", string>(
  "eden/HomeDirectory",
);
export const SystemDirectory = Context.Service<"eden/SystemDirectory", string>(
  "eden/SystemDirectory",
);
export const TrashDirectory = Context.Service<"eden/TrashDirectory", string>(
  "eden/TrashDirectory",
);
export const DistPath = Context.Service<"eden/DistPath", string>(
  "eden/DistPath",
);
