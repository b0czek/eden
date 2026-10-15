import type { RuntimeAppManifest } from "@edenapp/types";

export function testApp(
  id: string,
  overrides: Partial<RuntimeAppManifest> = {},
): RuntimeAppManifest {
  return {
    kind: "app",
    id,
    name: id,
    version: "1.0.0",
    frontend: { entry: "index.html" },
    isPrebuilt: false,
    isDevelopment: false,
    isCore: false,
    isRestricted: false,
    resolvedGrants: [],
    ...overrides,
  } as RuntimeAppManifest;
}
