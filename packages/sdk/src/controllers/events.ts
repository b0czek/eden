import type { Event } from "../events/event";

export interface TargetedNotification<Payload> {
  readonly payload: Payload;
  readonly viewIds: readonly number[];
}

export interface ControllerEvent<Payload> {
  /** Type-only public payload used by contract generation. */
  readonly contract?: { readonly payload: Payload };
  on(
    listener: (
      payload: Payload,
      viewIds?: readonly number[],
    ) => void | Promise<void>,
  ): () => void;
}

/** Expose a local notification to its selected views without publishing routing metadata. */
export function targetedEvent<Payload>(
  source: Pick<Event<TargetedNotification<Payload>>, "on">,
): ControllerEvent<Payload> {
  return {
    on: (listener) =>
      source.on(({ payload, viewIds }) => listener(payload, viewIds)),
  };
}
