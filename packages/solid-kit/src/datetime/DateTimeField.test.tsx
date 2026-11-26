import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DateTimeField, stepDateTime } from "./DateTimeField.js";

function renderField(
  initial: Date,
  bounds: { min?: Date; max?: Date } = {},
  locale = "en-GB",
) {
  const [value, setValue] = createSignal<Date | undefined>(initial);
  render(() => (
    <DateTimeField
      label="From"
      value={value()}
      onChange={setValue}
      placeholder="Any time"
      locale={locale}
      {...bounds}
    />
  ));
  fireEvent.click(screen.getByLabelText("From"));
  return value;
}

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

  it("speaks the app's locale and falls back to English for others", () => {
    renderField(new Date(2026, 10, 25, 14, 0), {}, "pl");
    expect(screen.getByRole("button", { name: "Gotowe" })).toBeTruthy();
    expect(screen.getByText("Godzina")).toBeTruthy();
    cleanup();

    renderField(new Date(2026, 10, 25, 14, 0), {}, "de");
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
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
