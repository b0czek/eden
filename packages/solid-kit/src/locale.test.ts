import { setupI18n } from "@edenapp/babel/solid";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fillString, solidKitStrings } from "./locale.js";

const app = setupI18n({
  resources: {
    en: { translation: { solidKit: { dialogs: { cancel: "Back" } } } },
    de: {
      translation: {
        solidKit: {
          dialogs: { cancel: "Abbrechen" },
          sidebar: { expand: "Ausklappen" },
        },
      },
    },
  },
});

describe("solid-kit strings", () => {
  afterEach(() => app.setLocale("en"));

  it("prefers the app's translation, then solid-kit's, then English", async () => {
    app.setLocale("de-AT");
    await vi.waitFor(() =>
      expect(solidKitStrings("dialogs").cancel).toBe("Abbrechen"),
    );
    expect(solidKitStrings("sidebar").expand).toBe("Ausklappen");
    expect(solidKitStrings("sidebar").collapse).toBe("Collapse sidebar");

    // The app's English override is not used for Polish, which solid-kit has.
    app.setLocale("pl-PL");
    expect(solidKitStrings("dialogs").cancel).toBe("Anuluj");
  });

  it("fills named values and leaves unknown ones", () => {
    expect(fillString("{count} more of {name}", { count: 2 })).toBe(
      "2 more of {name}",
    );
  });
});
