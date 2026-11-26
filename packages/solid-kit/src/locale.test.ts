import { afterEach, describe, expect, it } from "vitest";
import {
  addSolidKitStrings,
  setSolidKitLocale,
  solidKitStrings,
} from "./locale.js";

describe("solid-kit strings", () => {
  afterEach(() => setSolidKitLocale("en"));

  it("uses a regional locale's language and English for unknown locales", () => {
    setSolidKitLocale("pl-PL");
    expect(solidKitStrings().datetime.done).toBe("Gotowe");
    setSolidKitLocale("ja");
    expect(solidKitStrings().datetime.done).toBe("Done");
  });

  it("lets an app add a language, with English for strings it leaves out", () => {
    addSolidKitStrings("de", { datetime: { done: "Fertig" } });
    addSolidKitStrings("de", { datetime: { unit: { hour: "Stunde" } } });
    setSolidKitLocale("de-AT");
    const strings = solidKitStrings().datetime;
    expect(strings.done).toBe("Fertig");
    expect(strings.unit.hour).toBe("Stunde");
    expect(strings.unit.day).toBe("Day");
  });

  it("lets an app replace a built-in string", () => {
    addSolidKitStrings("pl", { datetime: { done: "OK" } });
    setSolidKitLocale("pl");
    expect(solidKitStrings().datetime.done).toBe("OK");
    expect(solidKitStrings().datetime.unit.hour).toBe("Godzina");
  });
});
