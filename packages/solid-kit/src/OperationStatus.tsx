import type { OperationSnapshot } from "@edenapp/types";
import { Show } from "solid-js";

export function OperationStatus(props: {
  label: string;
  description?: string;
  snapshot?: OperationSnapshot;
}) {
  const active = () =>
    !props.snapshot ||
    props.snapshot.status === "queued" ||
    props.snapshot.status === "running";
  const percentage = () => {
    const progress = props.snapshot?.progress;
    if (!progress?.total || progress.total <= 0) return undefined;
    return Math.max(
      0,
      Math.min(
        props.snapshot?.status === "succeeded" ? 100 : 99,
        Math.floor((progress.completed / progress.total) * 100),
      ),
    );
  };
  return (
    <div
      class="eden-flex-col eden-gap-sm"
      role="status"
      aria-live="polite"
      aria-busy={active()}
    >
      <div class="eden-flex eden-items-center eden-gap-sm">
        <Show when={active() && percentage() === undefined}>
          <span class="eden-spinner eden-spinner-sm" aria-hidden="true" />
        </Show>
        <strong>{props.label}</strong>
        <Show when={percentage() !== undefined}>
          <span class="eden-text-sm eden-text-secondary">{percentage()}%</span>
        </Show>
      </div>
      <Show when={props.description}>
        <span class="eden-text-sm eden-text-secondary">
          {props.description}
        </span>
      </Show>
      <Show when={percentage() !== undefined}>
        <div
          class="eden-progress"
          role="progressbar"
          aria-label={props.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentage()}
        >
          <div
            class="eden-progress-bar"
            classList={{
              "eden-progress-bar-success":
                props.snapshot?.status === "succeeded",
              "eden-progress-bar-danger": props.snapshot?.status === "failed",
            }}
            style={{ width: `${percentage()}%` }}
          />
        </div>
      </Show>
    </div>
  );
}
