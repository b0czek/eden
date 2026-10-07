import type { FileItem } from "@edenapp/files-core";
import type { DialogController } from "@edenapp/solid-kit/dialogs";
import type { FilesystemLocation } from "@edenapp/types";
import { createSignal, onCleanup } from "solid-js";
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
  operation: TransferOperation | "delete";
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
  const busy = () => progress() !== null;

  const pathExists = (location: FilesystemLocation) =>
    window.edenAPI.shellCommand("fs/exists", { location: location });

  const showFailureSummary = async (
    failures: TransferFailure[],
    total: number,
  ) => {
    if (failures.length === 0) return;
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

    const failures: TransferFailure[] = [];
    let rememberedCollisionAction: CollisionAction | undefined;

    try {
      for (let index = 0; index < items.length; index += 1) {
        if (disposed) break;
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

          if (disposed) break;
          if (operation === "copy") {
            await window.edenAPI.operations.wait(
              await window.edenAPI.shellCommand("fs/cp", {
                from: item.location,
                to: { volume: destinationDirectory.volume, path: targetPath },
                overwrite,
              }),
            );
          } else {
            await window.edenAPI.operations.wait(
              await window.edenAPI.shellCommand("fs/mv", {
                from: item.location,
                to: { volume: destinationDirectory.volume, path: targetPath },
                overwrite,
              }),
            );
          }
        } catch (error) {
          failures.push({
            item,
            message: (error as Error).message,
          });
        }
      }
    } finally {
      setProgress(null);
      options.refresh();
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
    if (!confirmed) return false;

    const failures: TransferFailure[] = [];
    try {
      for (let index = 0; index < items.length; index += 1) {
        if (disposed) break;
        const item = items[index];
        setProgress({
          operation: "delete",
          current: index + 1,
          total: items.length,
          itemName: item.name,
        });
        try {
          await window.edenAPI.operations.wait(
            await window.edenAPI.shellCommand("fs/delete", {
              location: item.location,
            }),
          );
        } catch (error) {
          failures.push({ item, message: (error as Error).message });
        }
      }
    } finally {
      setProgress(null);
      options.refresh();
    }

    await showFailureSummary(failures, items.length);
    return true;
  };

  return {
    pendingTransfer,
    progress,
    busy,
    beginTransfer,
    completeTransfer,
    deleteItems,
    cancelTransfer: () => {
      if (!busy()) setPendingTransfer(null);
    },
  };
};
