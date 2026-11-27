import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  AppearanceState,
  EdenAppearanceConfig,
  SettingsPanelResponse,
} from "@edenapp/types";
import { createTestEden, type TestEden } from "../../support/create-test-eden";

const appearance: EdenAppearanceConfig = {
  themes: [
    {
      id: "acme-light",
      name: { en: "Acme Light" },
      colorScheme: "light",
      colors: { "accent-primary": "#ff6600" },
    },
  ],
};

describe("appearance themes", () => {
  let eden: TestEden;

  afterEach(async () => {
    await eden?.dispose();
  });

  async function loginWithAppearanceGrant() {
    const user = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "appearance-user",
        name: "Appearance User",
        password: "password",
        grants: ["preset/appearance/manage"],
      }),
    );
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(user.username, "password"),
    );
  }

  it("switches Electron's scheme with the theme chosen in Settings", async () => {
    eden = await createTestEden({ config: { appearance } });
    await loginWithAppearanceGrant();
    expect(eden.platform.theme.colorScheme).toBe("dark");
    const states: AppearanceState[] = [];
    const stop = eden.runtime.appearance.onAppearanceChanged((state) =>
      states.push(state),
    );
    try {
      const panel = await eden.execute<SettingsPanelResponse>(
        "settings/panel",
        { panelId: "eden.appearance" },
      );
      expect(panel.panel).toMatchObject({
        data: {
          theme: "eden-dark",
          themes: [
            { id: "eden-dark", colorScheme: "dark" },
            { id: "eden-light", colorScheme: "light" },
            {
              id: "acme-light",
              colorScheme: "light",
              // Previews include the colors a theme inherits.
              colors: { "accent-primary": "#ff6600", "bg-primary": "#f5f5f7" },
            },
          ],
          wallpaper: { id: "eden-default" },
        },
      });

      await eden.execute("settings/action", {
        panelId: "eden.appearance",
        actionId: "set-theme",
        invocation: { value: "acme-light" },
      });
      expect(eden.platform.theme.colorScheme).toBe("light");
      expect(
        await eden.execute<AppearanceState>("appearance/get-appearance"),
      ).toMatchObject({ colorScheme: "light", theme: { id: "acme-light" } });
      expect(eden.runtime.appearance.getWallpaper().value).toContain("#f4f5fb");
      expect(states.map(({ theme }) => theme.id)).toEqual(["acme-light"]);

      expect(
        await eden.execute("settings/action", {
          panelId: "eden.appearance",
          actionId: "set-theme",
          invocation: { value: "missing" },
        }),
      ).toMatchObject({ success: false });
      expect(eden.runtime.appearance.getState().theme.id).toBe("acme-light");
    } finally {
      stop();
    }
  });

  it("applies appearance settings written without the appearance API", async () => {
    eden = await createTestEden({ config: { appearance } });
    const settings = eden.runtime.services.settings;
    await eden.runtime.effects.run(
      settings.set("com.eden", "appearance.theme", "acme-light"),
    );
    expect(eden.platform.theme.colorScheme).toBe("light");
    expect(eden.runtime.appearance.getState().theme.id).toBe("acme-light");

    await eden.runtime.effects.run(
      settings.set(
        "com.eden",
        "appearance.wallpaper",
        JSON.stringify({ type: "custom", value: "#123456" }),
      ),
    );
    expect(eden.runtime.appearance.getWallpaper().value).toBe("#123456");
  });

  it("restores the chosen scheme and theme after a restart", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "eden-appearance-"));
    try {
      const first = await createTestEden({ root, config: { appearance } });
      await first.runtime.effects.run(
        first.runtime.appearance.setTheme("acme-light"),
      );
      await first.dispose();

      eden = await createTestEden({ root, config: { appearance } });
      expect(eden.platform.theme.colorScheme).toBe("light");
      expect(eden.runtime.appearance.getState().theme.id).toBe("acme-light");
    } finally {
      await eden?.dispose();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
