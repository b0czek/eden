import type {
  OperationCompletion,
  EdenAPI,
  OperationHandle,
  OperationSnapshot,
  OperationsAPI,
  OperationObservation,
  EventData,
  EventName,
} from "@edenapp/types";

import { invokeEventListener } from "./event-subscriptions";

export function createOperationsAPI(
  api: Pick<EdenAPI, "shellCommand"> & {
    subscribe<T extends EventName>(
      event: T,
      callback: (data: EventData<T>) => void,
      operation?: OperationObservation,
    ): Promise<void>;
    unsubscribe<T extends EventName>(
      event: T,
      callback: (data: EventData<T>) => void,
      operation?: OperationObservation,
    ): void;
  },
): OperationsAPI {
  const get = async <C extends string>(handle: OperationHandle<C>) =>
    (await api.shellCommand("operation/get", { handle })) as OperationSnapshot<
      C,
      OperationCompletion<C>
    >;
  const observe = async <C extends string>(
    handle: OperationHandle<C>,
    listener: (snapshot: OperationSnapshot<C, OperationCompletion<C>>) => void,
    terminalOnly = false,
  ): Promise<() => void> => {
    let revision = 0;
    let active = true;
    const target = { command: handle.command, id: handle.id };
    const operation = { handle: target, terminalOnly };
    const reconcile = (snapshot: OperationSnapshot) => {
      if (
        active &&
        (!terminalOnly ||
          snapshot.status === "succeeded" ||
          snapshot.status === "failed" ||
          snapshot.status === "cancelled") &&
        snapshot.id === target.id &&
        snapshot.command === target.command &&
        snapshot.revision > revision
      ) {
        revision = snapshot.revision;
        invokeEventListener(
          listener,
          "operation/changed",
          snapshot as OperationSnapshot<C, OperationCompletion<C>>,
        );
      }
    };
    const callback = ({ snapshot }: { snapshot: OperationSnapshot }) =>
      reconcile(snapshot);
    const stop = () => {
      if (!active) return;
      active = false;
      api.unsubscribe("operation/changed", callback, operation);
    };
    try {
      await api.subscribe("operation/changed", callback, operation);
      reconcile(await get(target));
      return stop;
    } catch (error) {
      stop();
      throw error;
    }
  };
  const operations: OperationsAPI = {
    from: (handle) => {
      const target = { command: handle.command, id: handle.id };
      return {
        handle: { ...target },
        get: () => get(target),
        watch: (listener) => observe(target, listener),
        result: () => operations.wait(target),
        cancel: () => operations.cancel(target),
      };
    },
    get,
    cancel: (handle) => api.shellCommand("operation/cancel", { handle }),
    list: () => api.shellCommand("operation/list", {}),
    watch: observe,
    wait: async <C extends string>(
      handle: OperationHandle<C>,
    ): Promise<OperationCompletion<C>> => {
      let settle!: (
        snapshot: OperationSnapshot<C, OperationCompletion<C>>,
      ) => void;
      const terminal = new Promise<
        OperationSnapshot<C, OperationCompletion<C>>
      >((resolve) => {
        settle = resolve;
      });
      const stop = await observe(
        handle,
        (snapshot) => {
          if (
            snapshot.status === "succeeded" ||
            snapshot.status === "failed" ||
            snapshot.status === "cancelled"
          )
            settle(snapshot);
        },
        true,
      );
      try {
        const snapshot = await terminal;
        if (snapshot.status === "succeeded") return snapshot.result;
        if (snapshot.status === "cancelled") {
          const error = new Error("Operation cancelled");
          error.name = "AbortError";
          throw error;
        }
        if (snapshot.status === "failed") {
          if ("response" in snapshot)
            return snapshot.response as OperationCompletion<C>;
          const error = new Error(snapshot.error.message);
          error.name = snapshot.error.name;
          throw error;
        }
        throw new Error("Operation has not completed");
      } finally {
        stop();
      }
    },
  };
  return operations;
}
