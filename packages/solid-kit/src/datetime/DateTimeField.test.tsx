import { setupI18n } from "@edenapp/babel/solid";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DateTimeField, stepDateTime } from "./DateTimeField.js";

function renderField(initial: Date, bounds: { min?: Date; max?: Date } = {}) {
  const [value, setValue] = createSignal<Date | undefined>(initial);
  render(() => (
    <DateTimeField
      label="From"
      value={value()}
      onChange={setValue}
      placeholder="Any time"
      {...bounds}
    />
  ));
  fireEvent.click(screen.getByLabelText("From"));
  return value;
}

const app = setupI18n({ resources: {} });

describe("stepDateTime", () => {
  it("steps minutes onto whole steps, carries into the hour and drops seconds", () => {
    const at = new Date(2026, 10, 25, 14, 57, 30);
    expect(stepDateTime(at, "minute", 1)).toEqual(
      new Date(2026, 10, 25, 15, 0),
    );
    expect(stepDateTime(at, "minute", -1)).toEqual(
      new Date(2026, 10, 25, 14, 55),
    );
    expect(
      stepDateTime(new Date(2026, 10, 25, 0, 0), "minute", -1, {
        minuteStep: 15,
      }),
    ).toEqual(new Date(2026, 10, 24, 23, 45));
  });
});

describe("DateTimeField", () => {
  afterEach(() => {
    cleanup();
    app.setLocale("en");
    vi.useRealTimers();
  });

  it("stops at its bounds and disables the step that would pass them", () => {
    const min = new Date(2026, 10, 25, 14, 0);
    const value = renderField(new Date(2026, 10, 25, 14, 30), { min });

    fireEvent.click(screen.getByRole("button", { name: "Earlier day" }));
    expect(value()).toEqual(min);
    expect(
      (
        screen.getByRole("button", {
          name: "Earlier hour",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Later hour" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("switches language with the app's locale while open", () => {
    renderField(new Date(2026, 10, 25, 14, 0));
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
    app.setLocale("pl");
    expect(screen.getByRole("button", { name: "Gotowe" })).toBeTruthy();
  });

  it("floats until a tap outside or Escape, which stop at its panel", () => {
    renderField(new Date(2026, 10, 25, 14, 0));
    const seen: string[] = [];
    const listen = (event: Event) => seen.push(event.type);
    document.addEventListener("pointerdown", listen);
    document.addEventListener("keydown", listen);
    try {
      // Steppers inside do not count as a tap outside a surrounding panel.
      fireEvent.pointerDown(screen.getByRole("button", { name: "Later hour" }));
      expect(seen).toEqual([]);
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
      expect(seen).toEqual([]);

      fireEvent.click(screen.getByLabelText("From"));
      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    } finally {
      document.removeEventListener("pointerdown", listen);
      document.removeEventListener("keydown", listen);
    }
  });

  it("steps once per tap and repeats while held", () => {
    vi.useFakeTimers();
    const value = renderField(new Date(2026, 10, 25, 14, 0));
    const later = screen.getByRole("button", { name: "Later minute" });

    // A tap fires pointerdown, pointerup and click: one step.
    fireEvent.pointerDown(later);
    fireEvent.pointerUp(window);
    fireEvent.click(later);
    expect(value()).toEqual(new Date(2026, 10, 25, 14, 5));
    vi.advanceTimersByTime(1000);
    expect(value()).toEqual(new Date(2026, 10, 25, 14, 5));

    // Held: one step now, then repeats after a pause until released.
    fireEvent.pointerDown(later);
    vi.advanceTimersByTime(400 + 3 * 100);
    fireEvent.pointerUp(window);
    expect(value()).toEqual(new Date(2026, 10, 25, 14, 25));
    vi.advanceTimersByTime(1000);
    expect(value()).toEqual(new Date(2026, 10, 25, 14, 25));
  });
});
