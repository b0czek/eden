import type {
  CommandCompletion,
  CommandName,
  EdenAPI,
  OperationHandle,
  OperationSnapshot,
  OperationsAPI,
} from "@edenapp/types";

export function createOperationsAPI(
  api: Pick<EdenAPI, "shellCommand" | "subscribe" | "unsubscribe">,
): OperationsAPI {
  const get = async <C extends CommandName>(handle: OperationHandle<C>) =>
    (await api.shellCommand("operation/get", { handle })) as OperationSnapshot<
      C,
      CommandCompletion<C>
    >;
  const watch = async <C extends CommandName>(
    handle: OperationHandle<C>,
    listener: (snapshot: OperationSnapshot<C, CommandCompletion<C>>) => void,
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
        listener(snapshot as OperationSnapshot<C, CommandCompletion<C>>);
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
    wait: async <C extends CommandName>(
      handle: OperationHandle<C>,
    ): Promise<CommandCompletion<C>> => {
      let settle!: (
        snapshot: OperationSnapshot<C, CommandCompletion<C>>,
      ) => void;
      const terminal = new Promise<OperationSnapshot<C, CommandCompletion<C>>>(
        (resolve) => {
          settle = resolve;
        },
      );
      const stop = await watch(handle, (snapshot) => {
        if (snapshot.status === "succeeded" || snapshot.status === "failed")
          settle(snapshot);
      });
      try {
        const snapshot = await terminal;
        if (snapshot.status === "succeeded") return snapshot.result;
        if (snapshot.status === "failed") {
          if ("response" in snapshot)
            return snapshot.response as CommandCompletion<C>;
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
