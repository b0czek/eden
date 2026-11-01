import { createOperation } from "@edenapp/solid-kit";
import type { Operation, OperationCompletion } from "@edenapp/types";
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import { t } from "../i18n";
import type { TransferOperation } from "./fileTransfers";
import type {
  FileFailure,
  ShowFileError,
  ShowFileFailures,
} from "./useFileErrors";

export interface FileOperationProgress {
  operation: TransferOperation | "delete" | "trash" | "restore" | "open";
  current: number;
  total: number;
  itemName: string;
}

/** `skipped` excludes an item from the success count; `stop` ends the batch. */
export type BatchStepResult = undefined | "skipped" | "stop";

const isAbort = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

/** One file operation at a time, shared by folders and Trash. */
export function useFileActivity(options: {
  showError: ShowFileError;
  showFailures: ShowFileFailures;
}) {
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const observed = createOperation();
  const [progress, setProgress] = createSignal<FileOperationProgress | null>(
    null,
  );
  const [cancelling, setCancelling] = createSignal(false);
  const busy = createMemo(() => progress() !== null);
  const [showProgress, setShowProgress] = createSignal(false);
  createEffect(
    on(busy, (active) => {
      setShowProgress(false);
      if (!active) return;
      const timer = setTimeout(() => setShowProgress(true), 500);
      onCleanup(() => clearTimeout(timer));
    }),
  );

  const begin = (next: FileOperationProgress) => {
    if (disposed) throw new Error("File operation owner has been disposed");
    if (busy()) throw new Error("A file operation is already in progress");
    setCancelling(false);
    setProgress(next);
  };
  const finish = () => {
    setProgress(null);
    setCancelling(false);
  };

  /** Run one item and rethrow its failure to the caller. */
  const single = async <T>(
    operation: FileOperationProgress["operation"],
    itemName: string,
    run: () => Promise<T>,
  ): Promise<T> => {
    begin({ operation, current: 1, total: 1, itemName });
    try {
      return await run();
    } finally {
      finish();
    }
  };

  /** Run each item in turn and summarize failures; returns whether all succeeded. */
  const batch = async <T extends { name: string }>(
    operation: FileOperationProgress["operation"],
    items: readonly T[],
    step: (item: T) => Promise<BatchStepResult>,
  ): Promise<boolean> => {
    if (disposed || busy() || !items.length) return false;
    const failures: FileFailure[] = [];
    let succeeded = 0;
    begin({
      operation,
      current: 1,
      total: items.length,
      itemName: items[0].name,
    });
    try {
      for (const [index, item] of items.entries()) {
        if (disposed || cancelling()) break;
        setProgress({
          operation,
          current: index + 1,
          total: items.length,
          itemName: item.name,
        });
        try {
          const result = await step(item);
          if (result === "stop") break;
          if (result !== "skipped") succeeded += 1;
        } catch (error) {
          if (isAbort(error)) break;
          failures.push({ name: item.name, error });
        }
      }
    } finally {
      finish();
    }
    if (!disposed) await options.showFailures(failures, succeeded);
    return failures.length === 0;
  };

  const submit = <C extends string>(
    run: () => Promise<Operation<C>>,
  ): Promise<OperationCompletion<C>> => observed.run(run);

  const snapshot = () => (observed.pending() ? observed.snapshot() : undefined);
  /** Batches stop between items; a cancellable operation also stops mid-item. */
  const cancellable = () =>
    (progress()?.total ?? 0) > 1 || snapshot()?.cancellable === true;
  const cancel = () => {
    if (!busy() || cancelling() || !cancellable()) return;
    setCancelling(true);
    if (!snapshot()?.cancellable) return;
    void observed.cancel().catch((error: Error) => {
      setCancelling(false);
      if (!disposed) options.showError(t("files.cancelFailed"), error);
    });
  };

  return {
    busy,
    progress,
    showProgress,
    snapshot,
    cancelling,
    cancellable,
    cancel,
    single,
    batch,
    submit,
  };
}

export type FileActivity = ReturnType<typeof useFileActivity>;
