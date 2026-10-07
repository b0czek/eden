import type {
  OperationCompletion,
  Operation,
  OperationSnapshot,
} from "@edenapp/types";
import { createSignal, onCleanup } from "solid-js";

/** Observe an operation from submission through completion within a Solid owner. */
export function createOperation() {
  const [pending, setPending] = createSignal(false);
  const [snapshot, setSnapshot] = createSignal<OperationSnapshot>();
  let disposed = false;
  let submission: Promise<Operation> | undefined;
  let stop: (() => void) | undefined;
  let endObservation: (() => void) | undefined;

  onCleanup(() => {
    disposed = true;
    stop?.();
    endObservation?.();
  });

  const run = async <C extends string>(
    submit: () => Promise<Operation<C>>,
  ): Promise<OperationCompletion<C>> => {
    if (disposed) throw new Error("Operation owner has been disposed");
    if (pending()) throw new Error("An operation is already in progress");
    setPending(true);
    setSnapshot(undefined);
    try {
      submission = submit();
      const operation = (await submission) as Operation<C>;
      if (disposed) throw new Error("Operation owner has been disposed");
      let finish!: (
        snapshot?: OperationSnapshot<C, OperationCompletion<C>>,
      ) => void;
      const completion = new Promise<
        OperationSnapshot<C, OperationCompletion<C>> | undefined
      >((resolve) => {
        finish = resolve;
      });
      // Resolve on disposal so no listener or suspended observer outlives its UI.
      endObservation = () => finish();
      const unsubscribe = await operation.watch((update) => {
        if (disposed) return;
        setSnapshot(update);
        if (
          update.status === "succeeded" ||
          update.status === "failed" ||
          update.status === "cancelled"
        )
          finish(update);
      });
      stop = unsubscribe;
      if (disposed) {
        unsubscribe();
        throw new Error("Operation owner has been disposed");
      }
      const result = await completion;
      if (result?.status === "succeeded") return result.result;
      if (result?.status === "cancelled") {
        const error = new Error("Operation cancelled");
        error.name = "AbortError";
        throw error;
      }
      if (result?.status === "failed") {
        if ("response" in result)
          return result.response as OperationCompletion<C>;
        const error = new Error(result.error.message);
        error.name = result.error.name;
        throw error;
      }
      throw new Error("Operation owner has been disposed");
    } finally {
      stop?.();
      stop = undefined;
      endObservation = undefined;
      submission = undefined;
      setPending(false);
    }
  };

  const cancel = async () => {
    if (!submission) return;
    const operation = await submission;
    await operation.cancel();
  };

  return { run, pending, snapshot, cancel };
}
