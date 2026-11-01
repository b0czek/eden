import * as eden from "@edenapp/client";
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
import { moveToTrash } from "./trash";
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

interface UseFileTransfersOptions {
  refresh: () => void;
  dialogs: DialogController;
  showError: ShowFileError;
  showFailures: ShowFileFailures;
  isBlocked?: () => boolean;
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
  const resetCancellation = () => {
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

  const withTaskProgress = async <T>(
    operation: FileOperationProgress["operation"],
    item: FileItem,
    run: () => Promise<T>,
  ): Promise<T> => {
    if (disposed) throw new Error("File operation owner has been disposed");
    if (busy() || options.isBlocked?.())
      throw new Error("A file operation is already in progress");
    resetCancellation();
    setProgress({
      operation,
      current: 1,
      total: 1,
      itemName: item.name,
    });
    try {
      return await run();
    } finally {
      setProgress(null);
      resetCancellation();
    }
  };

  const withProgress = <C extends string>(
    operation: FileOperationProgress["operation"],
    item: FileItem,
    submit: () => Promise<Operation<C>>,
  ): Promise<OperationCompletion<C>> =>
    withTaskProgress(operation, item, () => observed.run(submit));

  const submitCopy = (
    item: FileItem,
    to: FilesystemLocation,
    overwrite = false,
  ) => eden.fs.cp(item.location, to, { overwrite });

  const submitMove = (
    item: FileItem,
    to: FilesystemLocation,
    overwrite = false,
  ) => eden.fs.mv(item.location, to, { overwrite });

  const deleteItem = (item: FileItem) =>
    item.location.volume === "home"
      ? moveToTrash(item, (from, to) =>
          observed.run(() => eden.fs.mv(from, to)),
        )
      : observed.run(() => eden.fs.delete(item.location));

  const operations = {
    copy: (item: FileItem, to: FilesystemLocation, overwrite = false) =>
      withProgress("copy", item, () => submitCopy(item, to, overwrite)),
    move: (item: FileItem, to: FilesystemLocation, overwrite = false) =>
      withProgress("move", item, () => submitMove(item, to, overwrite)),
    delete: (item: FileItem) =>
      withTaskProgress(
        item.location.volume === "home" ? "trash" : "delete",
        item,
        () => deleteItem(item),
      ),
    open: (item: FileItem) =>
      withProgress("open", item, () => eden.file.open(item.location)),
    openWith: (item: FileItem, appId: string) =>
      withProgress("open", item, () =>
        eden.file.openWith(item.location, appId),
      ),
  };

  const pathExists = (location: FilesystemLocation) => eden.fs.exists(location);

  const executeTransfer = async (
    items: FileItem[],
    operation: TransferOperation,
    destinationDirectory: FilesystemLocation,
  ): Promise<boolean> => {
    if (busy() || options.isBlocked?.() || items.length === 0) return false;

    resetCancellation();
    const failures: FileFailure[] = [];
    let succeeded = 0;
    let rememberedCollisionAction: CollisionAction | undefined;

    try {
      for (let index = 0; index < items.length; index += 1) {
        if (disposed || cancelling()) break;
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
              name: item.name,
              error: t("files.errors.sourceMissing"),
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
              name: item.name,
              error: t("files.errors.invalidTransferDestination"),
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

          if (disposed || cancelling()) break;
          const destination = {
            volume: destinationDirectory.volume,
            path: targetPath,
          };
          await observed.run(() =>
            operation === "copy"
              ? submitCopy(item, destination, overwrite)
              : submitMove(item, destination, overwrite),
          );
          succeeded += 1;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") break;
          failures.push({
            name: item.name,
            error,
          });
        }
      }
    } finally {
      setProgress(null);
      resetCancellation();
      if (!disposed) options.refresh();
    }

    if (!disposed) await options.showFailures(failures, succeeded);
    return failures.length === 0;
  };

  const beginTransfer = (operation: TransferOperation, items: FileItem[]) => {
    if (busy() || options.isBlocked?.() || items.length === 0) return false;
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
    if (busy() || options.isBlocked?.() || items.length === 0) return false;
    const toTrash = items.every((item) => item.location.volume === "home");
    const label = toTrash
      ? t("files.moveToTrash")
      : t("files.deletePermanently");
    const confirmed = await options.dialogs.confirm({
      title: label,
      message: t(
        toTrash
          ? "files.deleteSelectedConfirmation"
          : "files.permanentDeleteConfirmation",
        {
          count: items.length,
        },
      ),
      confirmLabel: label,
      cancelLabel: t("common.cancel"),
      tone: "danger",
    });
    if (!confirmed || busy() || options.isBlocked?.() || disposed) return false;

    const failures: FileFailure[] = [];
    let succeeded = 0;
    try {
      for (let index = 0; index < items.length; index += 1) {
        if (disposed || cancelling()) break;
        const item = items[index];
        setProgress({
          operation: item.location.volume === "home" ? "trash" : "delete",
          current: index + 1,
          total: items.length,
          itemName: item.name,
        });
        try {
          await deleteItem(item);
          succeeded += 1;
        } catch (error) {
          failures.push({ name: item.name, error });
        }
      }
    } finally {
      setProgress(null);
      resetCancellation();
      if (!disposed) options.refresh();
    }

    if (!disposed) await options.showFailures(failures, succeeded);
    return failures.length === 0;
  };

  return {
    pendingTransfer,
    progress,
    showProgress,
    snapshot: () => (observed.pending() ? observed.snapshot() : undefined),
    operations,
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
      setCancelling(true);
      void observed.cancel().catch((error: Error) => {
        resetCancellation();
        if (!disposed) options.showError(t("files.cancelFailed"), error);
      });
    },
  };
};

export type FileOperations = ReturnType<typeof useFileTransfers>["operations"];
