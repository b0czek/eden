import { buildSdkApps } from "@edenapp/scripts";

buildSdkApps({
  appsDir: "apps",
  outputDir: "dist/apps/prebuilt",
  force: false,
}).catch((error) => {
  console.error("Build failed:", error);
  process.exit(1);
});
