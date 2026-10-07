import type { FileItem } from "@edenapp/files-core";
import { createOperation } from "@edenapp/solid-kit";
import type { DialogController } from "@edenapp/solid-kit/dialogs";
import type {
  FilesystemLocation,
  Operation,
  OperationCompletion,
} from "@edenapp/types";
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import { openCollisionDialog } from "../dialogs/CollisionDialog";
import { t } from "../i18n";
import {
  type CollisionAction,
  findKeepBothPath,
  type PendingTransfer,
  planTransfer,
  rememberCollisionAction,
  type TransferOperation,
} from "./fileTransfers";

export interface FileOperationProgress {
  operation: TransferOperation | "delete" | "open";
  current: number;
  total: number;
  itemName: string;
}

interface TransferFailure {
  item: FileItem;
  message: string;
}

interface UseFileTransfersOptions {
  refresh: () => void;
  dialogs: DialogController;
}

const snapshotItems = (items: FileItem[]): FileItem[] =>
  items.map((item) => ({
    ...item,
    location: { ...item.location },
    modified: new Date(item.modified),
  }));

export const useFileTransfers = (options: UseFileTransfersOptions) => {
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const [pendingTransfer, setPendingTransfer] =
    createSignal<PendingTransfer | null>(null);
  const [progress, setProgress] = createSignal<FileOperationProgress | null>(
    null,
  );
  const observed = createOperation();
  const [cancelling, setCancelling] = createSignal(false);
  let cancelRequested = false;
  const resetCancellation = () => {
    cancelRequested = false;
    setCancelling(false);
  };
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

  const runOperation = async <C extends string>(
    operation: FileOperationProgress["operation"],
    item: FileItem,
    submit: () => Promise<Operation<C>>,
  ): Promise<OperationCompletion<C>> => {
    if (disposed) throw new Error("File operation owner has been disposed");
    if (busy()) throw new Error("A file operation is already in progress");
    resetCancellation();
    setProgress({ operation, current: 1, total: 1, itemName: item.name });
    try {
      return await observed.run(submit);
    } finally {
      setProgress(null);
      resetCancellation();
    }
  };

  const pathExists = (location: FilesystemLocation) =>
    window.edenAPI.shellCommand("fs/exists", { location: location });

  const showFailureSummary = async (
    failures: TransferFailure[],
    total: number,
  ) => {
    if (disposed || failures.length === 0) return;
    const details = failures
      .map((failure) => `${failure.item.name}: ${failure.message}`)
      .join("; ");
    await options.dialogs.alert({
      title: t("files.partialFailureTitle"),
      message: `${t("files.partialFailureMessage", {
        failed: failures.length,
        total,
      })} ${details}`,
      okLabel: t("common.ok"),
    });
  };

  const executeTransfer = async (
    items: FileItem[],
    operation: TransferOperation,
    destinationDirectory: FilesystemLocation,
  ): Promise<boolean> => {
    if (busy() || items.length === 0) return false;

    resetCancellation();
    const failures: TransferFailure[] = [];
    let rememberedCollisionAction: CollisionAction | undefined;

    try {
      for (let index = 0; index < items.length; index += 1) {
        if (disposed || cancelRequested) break;
        const item = items[index];
        setProgress({
          operation,
          current: index + 1,
          total: items.length,
          itemName: item.name,
        });

        try {
          if (!(await pathExists(item.location))) {
            failures.push({
              item,
              message: t("files.errors.sourceMissing"),
            });
            continue;
          }

          const transferPlan = planTransfer(
            item,
            destinationDirectory,
            operation,
          );
          if (transferPlan.kind === "invalid") {
            failures.push({
              item,
              message: t("files.errors.invalidTransferDestination"),
            });
            continue;
          }
          if (transferPlan.kind === "no-op") {
            continue;
          }

          let targetPath: string;
          let overwrite = false;
          if (transferPlan.kind === "keep-both") {
            targetPath = await findKeepBothPath(
              item,
              destinationDirectory.path,
              t("files.copySuffix"),
              (path) =>
                pathExists({ volume: destinationDirectory.volume, path }),
            );
          } else {
            targetPath = transferPlan.targetPath;
            if (
              await pathExists({
                volume: destinationDirectory.volume,
                path: targetPath,
              })
            ) {
              let action = rememberedCollisionAction;
              if (!action) {
                const decision = await openCollisionDialog({
                  dialogs: options.dialogs,
                  itemName: item.name,
                  targetPath,
                });
                if (decision.action === "cancel") break;
                rememberedCollisionAction = rememberCollisionAction(
                  rememberedCollisionAction,
                  decision,
                );
                action = decision.action;
              }

              if (action === "skip") continue;
              if (action === "keep-both") {
                targetPath = await findKeepBothPath(
                  item,
                  destinationDirectory.path,
                  t("files.copySuffix"),
                  (path) =>
                    pathExists({ volume: destinationDirectory.volume, path }),
                );
              } else {
                overwrite = true;
              }
            }
          }

          if (disposed || cancelRequested) break;
          if (operation === "copy") {
            await observed.run(() =>
              window.edenAPI.shellCommand("fs/cp", {
                from: item.location,
                to: { volume: destinationDirectory.volume, path: targetPath },
                overwrite,
              }),
            );
          } else {
            await observed.run(() =>
              window.edenAPI.shellCommand("fs/mv", {
                from: item.location,
                to: { volume: destinationDirectory.volume, path: targetPath },
                overwrite,
              }),
            );
          }
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") break;
          failures.push({
            item,
            message: (error as Error).message,
          });
        }
      }
    } finally {
      setProgress(null);
      resetCancellation();
      if (!disposed) options.refresh();
    }

    await showFailureSummary(failures, items.length);
    return true;
  };

  const beginTransfer = (operation: TransferOperation, items: FileItem[]) => {
    if (busy() || items.length === 0) return false;
    setPendingTransfer({ operation, items: snapshotItems(items) });
    return true;
  };

  const completeTransfer = async (destinationDirectory: FilesystemLocation) => {
    const request = pendingTransfer();
    if (!request || busy()) return false;
    try {
      return await executeTransfer(
        request.items,
        request.operation,
        destinationDirectory,
      );
    } finally {
      setPendingTransfer(null);
    }
  };

  const deleteItems = async (items: FileItem[]) => {
    if (busy() || items.length === 0) return false;
    const confirmed = await options.dialogs.confirm({
      title: t("common.delete"),
      message: t("files.deleteSelectedConfirmation", {
        count: items.length,
      }),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      tone: "danger",
    });
    if (!confirmed || busy() || disposed) return false;

    const failures: TransferFailure[] = [];
    try {
      for (let index = 0; index < items.length; index += 1) {
        if (disposed || cancelRequested) break;
        const item = items[index];
        setProgress({
          operation: "delete",
          current: index + 1,
          total: items.length,
          itemName: item.name,
        });
        try {
          await observed.run(() =>
            window.edenAPI.shellCommand("fs/delete", {
              location: item.location,
            }),
          );
        } catch (error) {
          failures.push({ item, message: (error as Error).message });
        }
      }
    } finally {
      setProgress(null);
      resetCancellation();
      if (!disposed) options.refresh();
    }

    await showFailureSummary(failures, items.length);
    return true;
  };

  return {
    pendingTransfer,
    progress,
    showProgress,
    snapshot: () => (observed.pending() ? observed.snapshot() : undefined),
    runOperation,
    busy,
    cancelling,
    beginTransfer,
    completeTransfer,
    deleteItems,
    cancelTransfer: () => {
      if (!busy()) {
        setPendingTransfer(null);
        return;
      }
      if (progress()?.operation !== "copy" || cancelling()) return;
      cancelRequested = true;
      setCancelling(true);
      void observed.cancel().catch((error: Error) => {
        resetCancellation();
        if (!disposed)
          void options.dialogs.alert({
            title: t("files.cancelFailed"),
            message: error.message,
            okLabel: t("common.ok"),
          });
      });
    },
  };
};
