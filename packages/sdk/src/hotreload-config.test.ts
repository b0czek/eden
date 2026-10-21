import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { EdenConfig } from "@edenapp/types";
import * as Effect from "effect/Effect";
import {
  HOT_RELOAD_PROTOCOL_VERSION,
  loadHotReloadAppsState,
  loadHotReloadEnabledState,
  saveHotReloadEnabledState,
} from "./hotreload-config";

describe("development source state", () => {
  let directory: string;
  let config: EdenConfig;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "eden-hot-reload-"));
    config = { hotReload: { enabled: true, stateDirectory: directory } };
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("saves normalized enabled apps in a new state directory", async () => {
    config = {
      hotReload: {
        enabled: true,
        stateDirectory: path.join(directory, "state"),
      },
    };
    await Effect.runPromise(
      saveHotReloadEnabledState(
        { apps: ["com.example.z", "com.example.a", "com.example.z"] },
        config,
      ),
    );
    expect(
      JSON.parse(
        await fs.readFile(
          path.join(directory, "state", "enabled.json"),
          "utf-8",
        ),
      ),
    ).toEqual({
      apps: ["com.example.a", "com.example.z"],
    });
    await expect(
      Effect.runPromise(loadHotReloadEnabledState(config)),
    ).resolves.toEqual({
      apps: ["com.example.a", "com.example.z"],
    });
  });

  it("loads valid source apps for the current protocol", async () => {
    await fs.writeFile(
      path.join(directory, "apps.json"),
      JSON.stringify({
        protocolVersion: HOT_RELOAD_PROTOCOL_VERSION,
        apps: [
          { id: "com.example.dev", sourcePath: "/source", launchOnStart: true },
        ],
      }),
    );

    await expect(
      Effect.runPromise(loadHotReloadAppsState(config)),
    ).resolves.toEqual({
      protocolVersion: HOT_RELOAD_PROTOCOL_VERSION,
      apps: [
        { id: "com.example.dev", sourcePath: "/source", launchOnStart: true },
      ],
    });
  });

  it("rejects state written for a different protocol", async () => {
    await fs.writeFile(
      path.join(directory, "apps.json"),
      JSON.stringify({ protocolVersion: 999, apps: [] }),
    );

    await expect(
      Effect.runPromise(loadHotReloadAppsState(config)),
    ).resolves.toEqual({
      protocolVersion: HOT_RELOAD_PROTOCOL_VERSION,
      apps: [],
    });
  });
});
