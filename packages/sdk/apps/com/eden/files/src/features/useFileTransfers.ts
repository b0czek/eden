import * as eden from "@edenapp/client";
import type { FileItem } from "@edenapp/files-core";
import type { DialogController } from "@edenapp/solid-kit/dialogs";
import type { FilesystemLocation } from "@edenapp/types";
import { createSignal } from "solid-js";
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
import type { FileActivity } from "./useFileActivity";

interface UseFileTransfersOptions {
  activity: FileActivity;
  refresh: () => void;
  dialogs: DialogController;
  usesTrash: (location: FilesystemLocation) => boolean;
}

const snapshotItems = (items: FileItem[]): FileItem[] =>
  items.map((item) => ({
    ...item,
    location: { ...item.location },
    modified: new Date(item.modified),
  }));

export const useFileTransfers = (options: UseFileTransfersOptions) => {
  const { activity } = options;
  const [pendingTransfer, setPendingTransfer] =
    createSignal<PendingTransfer | null>(null);

  const submitCopy = (
    item: FileItem,
    to: FilesystemLocation,
    overwrite = false,
  ) => activity.submit(() => eden.fs.cp(item.location, to, { overwrite }));

  const submitMove = (
    item: FileItem,
    to: FilesystemLocation,
    overwrite = false,
  ) => activity.submit(() => eden.fs.mv(item.location, to, { overwrite }));

  const submitDelete = (item: FileItem) =>
    activity.submit(() =>
      options.usesTrash(item.location)
        ? eden.fs.trash(item.location)
        : eden.fs.delete(item.location),
    );

  const deleteOperation = (item: FileItem) =>
    options.usesTrash(item.location) ? "trash" : "delete";

  const operations = {
    copy: (item: FileItem, to: FilesystemLocation, overwrite = false) =>
      activity.single("copy", item.name, () => submitCopy(item, to, overwrite)),
    move: (item: FileItem, to: FilesystemLocation, overwrite = false) =>
      activity.single("move", item.name, () => submitMove(item, to, overwrite)),
    delete: (item: FileItem) =>
      activity.single(deleteOperation(item), item.name, () =>
        submitDelete(item),
      ),
    open: (item: FileItem) =>
      activity.single("open", item.name, () =>
        activity.submit(() => eden.file.open(item.location)),
      ),
    openWith: (item: FileItem, appId: string) =>
      activity.single("open", item.name, () =>
        activity.submit(() => eden.file.openWith(item.location, appId)),
      ),
  };

  const pathExists = (location: FilesystemLocation) => eden.fs.exists(location);

  const executeTransfer = async (
    items: FileItem[],
    operation: TransferOperation,
    destinationDirectory: FilesystemLocation,
  ): Promise<boolean> => {
    let rememberedCollisionAction: CollisionAction | undefined;
    const keepBothPath = (item: FileItem) =>
      findKeepBothPath(
        item,
        destinationDirectory.path,
        t("files.copySuffix"),
        (path) => pathExists({ volume: destinationDirectory.volume, path }),
      );
    try {
      return await activity.batch(operation, items, async (item) => {
        if (!(await pathExists(item.location)))
          throw new Error(t("files.errors.sourceMissing"));
        const transferPlan = planTransfer(
          item,
          destinationDirectory,
          operation,
        );
        if (transferPlan.kind === "invalid")
          throw new Error(t("files.errors.invalidTransferDestination"));
        if (transferPlan.kind === "no-op") return "skipped";

        let targetPath: string;
        let overwrite = false;
        if (transferPlan.kind === "keep-both") {
          targetPath = await keepBothPath(item);
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
              if (decision.action === "cancel") return "stop";
              rememberedCollisionAction = rememberCollisionAction(
                rememberedCollisionAction,
                decision,
              );
              action = decision.action;
            }
            if (action === "skip") return "skipped";
            if (action === "keep-both") targetPath = await keepBothPath(item);
            else overwrite = true;
          }
        }

        const destination = {
          volume: destinationDirectory.volume,
          path: targetPath,
        };
        await (operation === "copy"
          ? submitCopy(item, destination, overwrite)
          : submitMove(item, destination, overwrite));
      });
    } finally {
      options.refresh();
    }
  };

  const beginTransfer = (operation: TransferOperation, items: FileItem[]) => {
    if (activity.busy() || items.length === 0) return false;
    setPendingTransfer({ operation, items: snapshotItems(items) });
    return true;
  };

  const completeTransfer = async (destinationDirectory: FilesystemLocation) => {
    const request = pendingTransfer();
    if (!request || activity.busy()) return false;
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
    if (activity.busy() || items.length === 0) return false;
    const toTrash = items.every((item) => options.usesTrash(item.location));
    const label = toTrash
      ? t("files.moveToTrash")
      : t("files.deletePermanently");
    const confirmed = await options.dialogs.confirm({
      title: label,
      message: t(
        toTrash
          ? "files.deleteSelectedConfirmation"
          : "files.permanentDeleteConfirmation",
        { count: items.length },
      ),
      confirmLabel: label,
      cancelLabel: t("common.cancel"),
      tone: "danger",
    });
    if (!confirmed) return false;
    try {
      return await activity.batch(
        toTrash ? "trash" : "delete",
        items,
        async (item) => {
          await submitDelete(item);
        },
      );
    } finally {
      options.refresh();
    }
  };

  return {
    pendingTransfer,
    operations,
    beginTransfer,
    completeTransfer,
    deleteItems,
    cancelPendingTransfer: () => setPendingTransfer(null),
  };
};

export type FileOperations = ReturnType<typeof useFileTransfers>["operations"];
