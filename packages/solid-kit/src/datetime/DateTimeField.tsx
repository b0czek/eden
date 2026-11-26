import {
  BiRegularCalendar,
  BiRegularMinus,
  BiRegularPlus,
} from "solid-icons/bi";
import { createSignal, createUniqueId, For, onCleanup, Show } from "solid-js";
import "./DateTimeField.css";
import {
  type DeepPartial,
  type SolidKitStrings,
  solidKitLocale,
  solidKitStrings,
} from "../locale.js";

export type DateTimeUnit = "day" | "hour" | "minute";

export interface DateTimeFieldProps {
  /** Names the field, such as "From". */
  label: string;
  value: Date | undefined;
  onChange: (value: Date) => void;
  /** Shown while `value` is unset. */
  placeholder: string;
  min?: Date;
  max?: Date;
  /** Minutes moved by one minute step. Defaults to 5. */
  minuteStep?: number;
  /** Replaces the field's built-in strings, such as `{ done: "Apply" }`. */
  labels?: DeepPartial<SolidKitStrings["datetime"]>;
  class?: string;
}

const units: readonly DateTimeUnit[] = ["day", "hour", "minute"];
const repeatDelayMs = 400;
const repeatEveryMs = 100;

/** `time` moved one step of `unit` in `direction`, kept within the bounds. */
export function stepDateTime(
  time: Date,
  unit: DateTimeUnit,
  direction: 1 | -1,
  options: { minuteStep?: number; min?: Date; max?: Date } = {},
): Date {
  const next = new Date(time);
  next.setSeconds(0, 0);
  if (unit === "day") next.setDate(next.getDate() + direction);
  else if (unit === "hour") next.setHours(next.getHours() + direction);
  else {
    // Land on a multiple of the step, so 14:57 goes to 15:00 or 14:55.
    const step = Math.max(1, options.minuteStep ?? 5);
    const minutes = next.getMinutes();
    next.setMinutes(
      direction > 0
        ? Math.floor(minutes / step) * step + step
        : Math.ceil(minutes / step) * step - step,
    );
  }
  if (options.min && next < options.min) return new Date(options.min);
  if (options.max && next > options.max) return new Date(options.max);
  return next;
}

/**
 * A date and time chosen by touch: a button shows the value and opens steppers
 * for the day, hour and minute below it. Holding a stepper repeats it.
 */
export function DateTimeField(props: DateTimeFieldProps) {
  const [open, setOpen] = createSignal(false);
  const strings = () => solidKitStrings("datetime", props.labels);
  const id = `eden-datetime-${createUniqueId()}`;
  const format = (options: Intl.DateTimeFormatOptions, time: Date) =>
    new Intl.DateTimeFormat(solidKitLocale(), options).format(time);
  const bounds = () => ({
    minuteStep: props.minuteStep,
    min: props.min,
    max: props.max,
  });
  // An unset field starts from now, on a whole step, within the bounds.
  const shown = () => {
    if (props.value) return props.value;
    const now = new Date();
    return stepDateTime(
      stepDateTime(now, "minute", 1, bounds()),
      "minute",
      -1,
      bounds(),
    );
  };
  const step = (unit: DateTimeUnit, direction: 1 | -1) =>
    stepDateTime(shown(), unit, direction, bounds());
  const canStep = (unit: DateTimeUnit, direction: 1 | -1) =>
    step(unit, direction).getTime() !== shown().getTime();
  const text = (unit: DateTimeUnit, time: Date) => {
    if (unit === "day") {
      return format({ weekday: "short", day: "numeric", month: "short" }, time);
    }
    if (unit === "hour") return format({ hour: "numeric" }, time);
    return String(time.getMinutes()).padStart(2, "0");
  };

  const stepper = (unit: DateTimeUnit, direction: 1 | -1) => {
    let delay: ReturnType<typeof setTimeout> | undefined;
    let repeat: ReturnType<typeof setInterval> | undefined;
    let pressed = false;
    const stop = () => {
      clearTimeout(delay);
      clearInterval(repeat);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    const run = () => {
      if (!canStep(unit, direction)) return stop();
      props.onChange(step(unit, direction));
    };
    onCleanup(stop);
    const name = () => strings()[direction > 0 ? "later" : "earlier"][unit];
    return (
      <button
        type="button"
        class="eden-btn eden-btn-ghost eden-btn-square"
        title={name()}
        aria-label={name()}
        disabled={!canStep(unit, direction)}
        onPointerDown={(event) => {
          if (event.button > 0) return;
          stop();
          pressed = true;
          run();
          // A disabled button gets no pointerup, so listen on the window.
          window.addEventListener("pointerup", stop);
          window.addEventListener("pointercancel", stop);
          delay = setTimeout(() => {
            repeat = setInterval(run, repeatEveryMs);
          }, repeatDelayMs);
        }}
        onPointerLeave={stop}
        onClick={() => {
          // A press already stepped; a click without one comes from the keyboard.
          if (pressed) pressed = false;
          else run();
        }}
      >
        {direction > 0 ? <BiRegularPlus /> : <BiRegularMinus />}
      </button>
    );
  };

  return (
    <div class={`eden-datetime-field ${props.class ?? ""}`} data-open={open()}>
      <label class="eden-datetime-label" for={id}>
        {props.label}
      </label>
      <button
        id={id}
        type="button"
        class="eden-input eden-datetime-value"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <BiRegularCalendar />
        <span data-placeholder={!props.value}>
          {props.value
            ? format(
                {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  hour: "numeric",
                  minute: "2-digit",
                },
                props.value,
              )
            : props.placeholder}
        </span>
      </button>
      <Show when={open()}>
        <div class="eden-datetime-panel">
          <For each={units}>
            {(unit) => (
              <div class="eden-datetime-step">
                <span class="eden-datetime-step-name">
                  {strings().unit[unit]}
                </span>
                {stepper(unit, -1)}
                <output class="eden-datetime-step-value">
                  {text(unit, shown())}
                </output>
                {stepper(unit, 1)}
              </div>
            )}
          </For>
          <button
            type="button"
            class="eden-btn eden-btn-primary eden-datetime-done"
            onClick={() => setOpen(false)}
          >
            {strings().done}
          </button>
        </div>
      </Show>
    </div>
  );
}
