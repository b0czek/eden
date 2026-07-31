import { buildSdkApps, loadConfig } from "@edenapp/scripts";

async function buildDevApps(): Promise<void> {
  const config = await loadConfig("eden.dev.config.json");

  await buildSdkApps({
    appsDir: "apps",
    outputDir: "dist/apps/prebuilt",
    force: false,
    includeAppIds: config.apps
      .filter((app) => app.source === "builtin")
      .map((app) => app.id),
  });
}

buildDevApps().catch((error) => {
  console.error("Build failed:", error);
  process.exit(1);
});
