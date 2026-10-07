import type {
  OperationCompletion,
  EdenAPI,
  OperationHandle,
  OperationSnapshot,
  OperationsAPI,
} from "@edenapp/types";

export function createOperationsAPI(
  api: Pick<EdenAPI, "shellCommand" | "subscribe" | "unsubscribe">,
): OperationsAPI {
  const get = async <C extends string>(handle: OperationHandle<C>) =>
    (await api.shellCommand("operation/get", { handle })) as OperationSnapshot<
      C,
      OperationCompletion<C>
    >;
  const watch = async <C extends string>(
    handle: OperationHandle<C>,
    listener: (snapshot: OperationSnapshot<C, OperationCompletion<C>>) => void,
  ): Promise<() => void> => {
    let revision = 0;
    let active = true;
    const reconcile = (snapshot: OperationSnapshot) => {
      if (
        active &&
        snapshot.id === handle.id &&
        snapshot.command === handle.command &&
        snapshot.revision > revision
      ) {
        revision = snapshot.revision;
        listener(snapshot as OperationSnapshot<C, OperationCompletion<C>>);
      }
    };
    const callback = ({ snapshot }: { snapshot: OperationSnapshot }) =>
      reconcile(snapshot);
    const stop = () => {
      if (!active) return;
      active = false;
      api.unsubscribe("operation/changed", callback);
    };
    try {
      await api.subscribe("operation/changed", callback);
      reconcile(await get(handle));
      return stop;
    } catch (error) {
      stop();
      throw error;
    }
  };
  return {
    get,
    list: () => api.shellCommand("operation/list", {}),
    watch,
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
      const stop = await watch(handle, (snapshot) => {
        if (snapshot.status === "succeeded" || snapshot.status === "failed")
          settle(snapshot);
      });
      try {
        const snapshot = await terminal;
        if (snapshot.status === "succeeded") return snapshot.result;
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
}
