import { setupI18n } from "@edenapp/babel/solid";
import { afterEach, describe, expect, it, vi } from "vitest";
import { solidKitStrings } from "./locale.js";

const app = setupI18n({
  resources: {
    en: { translation: { solidKit: { datetime: { done: "Apply" } } } },
    de: {
      translation: {
        solidKit: { datetime: { done: "Fertig", unit: { hour: "Stunde" } } },
      },
    },
  },
});

describe("solid-kit strings", () => {
  afterEach(() => app.setLocale("en"));

  it("prefers the app's translation, then solid-kit's, then English", async () => {
    app.setLocale("de-AT");
    await vi.waitFor(() =>
      expect(solidKitStrings("datetime").done).toBe("Fertig"),
    );
    expect(solidKitStrings("datetime").unit.hour).toBe("Stunde");
    expect(solidKitStrings("datetime").unit.day).toBe("Day");

    // The app's English override is not used for Polish, which solid-kit has.
    app.setLocale("pl-PL");
    expect(solidKitStrings("datetime").done).toBe("Gotowe");
    expect(solidKitStrings("datetime").unit.hour).toBe("Godzina");
  });

  it("lets a component's labels win over every translation", async () => {
    await vi.waitFor(() =>
      expect(solidKitStrings("datetime").done).toBe("Apply"),
    );
    expect(solidKitStrings("datetime", { done: "Use time" }).done).toBe(
      "Use time",
    );
  });
});
