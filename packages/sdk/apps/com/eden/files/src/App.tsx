import * as eden from "@edenapp/client";
import {
  DisplayOptionsModal,
  type FileItem,
  FileList,
  useFileActivationPreference,
  useVolumeEject,
} from "@edenapp/files-core";
import { createDialogs, DialogHost } from "@edenapp/solid-kit/dialogs";
import { notification } from "@edenapp/tablets";
import type { FileOpenedEvent, FilesystemLocation } from "@edenapp/types";
import type { Component } from "solid-js";
import { onCleanup, onMount, Show } from "solid-js";
import {
  SelectionActionBar,
  TransferActionBar,
} from "./components/FileModeActionBars";
import { FilePlaces } from "./components/FilePlaces";
import { FilesToolbar } from "./components/FilesToolbar";
import { TransferActivity } from "./components/TransferActivity";
import { TrashView } from "./components/TrashView";
import { useDirectoryBrowser } from "./features/useDirectoryBrowser";
import { useDisplayPreferences } from "./features/useDisplayPreferences";
import { useExplorerContextMenus } from "./features/useExplorerContextMenus";
import { useFileActions } from "./features/useFileActions";
import { useFileActivity } from "./features/useFileActivity";
import { useFileErrors } from "./features/useFileErrors";
import { useFilesKeyboardShortcuts } from "./features/useFilesKeyboardShortcuts";
import { useFileTransfers } from "./features/useFileTransfers";
import { usePinnedFolders } from "./features/usePinnedFolders";
import { useTrash } from "./features/useTrash";
import { getExplorerLabels, getTrashLabels, initLocale, t } from "./i18n";

const App: Component = () => {
  const dialogs = createDialogs();
  const openWithSingleClick = useFileActivationPreference();

  const display = useDisplayPreferences({
    onChange: () => {
      const currentItems = items();
      if (currentItems.length > 0) setItems(sortItems(currentItems));
    },
  });
  const {
    preferences: displayPreferences,
    sortItems,
    change: handlePreferencesChange,
  } = display;

  const { showError, showFailures } = useFileErrors(dialogs);
  const activity = useFileActivity({ showError, showFailures });

  const volumeRemoval = useVolumeEject({
    onRemoved: (volume) => {
      void notification.push(
        t("files.eject"),
        t("files.safeToRemove", { name: volume.label }),
        { type: "success" },
      );
    },
    onError: (error, volume) => {
      showError(`${t("files.ejectFailed")} (${volume.label})`, error);
    },
  });

  const directory = useDirectoryBrowser({
    sortItems,
    showError,
    onVolumeRemoved: (volume) => {
      activity.cancel();
      transfers.cancelPendingTransfer();
      if (!volumeRemoval.isPending(volume))
        void notification.push(
          t("files.volume"),
          t("files.volumeDisconnected"),
          { type: "warning" },
        );
    },
  });
  const {
    navigation,
    selection,
    selectedItem,
    setSelectedItem,
    scrollToSelected,
    setScrollToSelected,
    trashSelected,
  } = directory;
  const {
    currentPath,
    currentVolume,
    currentLocation,
    items,
    volumes,
    readOnly,
    setItems,
    loading,
    refresh,
  } = navigation;

  const usesTrash = (location: FilesystemLocation) =>
    volumes().some(
      (volume) => volume.id === location.volume && volume.supportsTrash,
    );

  const pinned = usePinnedFolders({ dialogs, showError });
  const pinCurrentFolder = () =>
    pinned.pinFolder(
      currentLocation(),
      currentPath().split("/").filter(Boolean).pop() ?? t("files.home"),
    );
  onMount(async () => {
    const handleFileOpened = (data: FileOpenedEvent) => {
      if (data.location.path) {
        void directory.openPath(data.location);
      }
    };
    const subscribed = eden.file.subscribe("opened", handleFileOpened);
    onCleanup(() => {
      eden.file.unsubscribe("opened", handleFileOpened);
    });
    await initLocale();
    await pinned.load();
    await display.load();

    const launchFile = window.edenAPI.getLaunchFile();
    if (launchFile) void directory.openPath(launchFile);

    await subscribed;
  });

  const transfers = useFileTransfers({
    activity,
    refresh,
    dialogs,
    usesTrash,
  });
  const trash = useTrash({
    activity,
    dialogs,
    sortItems: display.sortTrashItems,
  });

  const {
    duplicateItem,
    openItem,
    showItemDetails,
    getOpenWithMenuItems,
    handleItemClick: handleSingleItemClick,
    handleItemActivate,
    promptCreateFolder,
    promptCreateFile,
    promptRename,
    promptDelete,
    handleDeleteClick,
    handleDeleteShortcut,
  } = useFileActions({
    currentVolume,
    currentPath,
    refresh,
    navigateTo: directory.navigate,
    operations: transfers.operations,
    usesTrash,
    showError,
    dialogs,
    setSelectedItem,
    setScrollToSelected,
  });

  const handleExplorerItemClick = (
    item: FileItem,
    event?: MouseEvent | KeyboardEvent,
  ) => {
    if (
      selection.selectionMode() ||
      event?.ctrlKey ||
      event?.metaKey ||
      event?.shiftKey
    ) {
      selection.toggleItem(item, event);
      return;
    }
    handleSingleItemClick(item);
  };

  const startTransfer = (
    operation: "copy" | "move",
    selected = selection.selectedFiles(),
  ) => {
    if (operation === "move" && readOnly()) return;
    if (transfers.beginTransfer(operation, selected)) selection.exit();
  };

  const deleteSelected = async () => {
    if (readOnly()) return;
    if (await transfers.deleteItems(selection.selectedFiles()))
      selection.exit();
  };

  const busy = () => activity.busy() || Boolean(transfers.pendingTransfer());

  const { handleItemContextMenu, handleBackgroundContextMenu, showVolumeMenu } =
    useExplorerContextMenus({
      volumes,
      usesTrash,
      currentLocation,
      findPin: pinned.find,
      canPin: pinned.canPin,
      pinFolder: pinned.pinFolder,
      unpinFolder: pinned.unpin,
      pinCurrentFolder,
      isVolumeEjectPending: volumeRemoval.isPending,
      ejectVolume: volumeRemoval.eject,
      openItem,
      showItemDetails,
      getOpenWithMenuItems,
      promptRename,
      duplicateItem,
      promptDelete,
      refresh,
      setSelectedItem,
      setScrollToSelected,
      promptCreateFolder,
      promptCreateFile,
      copyItem: (item) => startTransfer("copy", [item]),
      moveItem: (item) => startTransfer("move", [item]),
      readOnly,
      isBusy: busy,
      clearSelection: selection.exit,
    });

  const activeSelection = () => (trashSelected() ? trash.selection : selection);
  useFilesKeyboardShortcuts({
    busy: activity.busy,
    hasPendingTransfer: () => Boolean(transfers.pendingTransfer()),
    selectionMode: () => activeSelection().selectionMode(),
    selectedCount: () => activeSelection().selectedPaths().length,
    shortcutItems: () => {
      if (trashSelected()) return [];
      if (selection.selectionMode()) return selection.selectedFiles();
      const item = items().find(
        (candidate) => candidate.location.path === selectedItem(),
      );
      return item ? [item] : [];
    },
    displayPreferences,
    cancelTransfer: transfers.cancelPendingTransfer,
    exitSelection: () => activeSelection().exit(),
    selectAll: () => activeSelection().selectAll(),
    startTransfer,
    deleteSelected: () =>
      trashSelected() ? trash.deleteSelected() : deleteSelected(),
    changePreferences: handlePreferencesChange,
  });

  const activityProgress = () =>
    activity.showProgress() ? activity.progress() : null;

  return (
    <div class="file-explorer files-layout">
      <FilePlaces
        volumes={volumes()}
        currentLocation={currentLocation()}
        trashSelected={trashSelected()}
        onSelectTrash={directory.openTrash}
        onTrashActions={trash.showEmptyMenu}
        pins={pinned.pins()}
        pinCurrentDisabled={
          trashSelected() ||
          loading() ||
          activity.busy() ||
          !pinned.canPin(currentLocation())
        }
        onPinCurrent={() => void pinCurrentFolder()}
        onSelectPin={(pin) => void directory.openPinnedFolder(pin.location)}
        onPinActions={pinned.showMenu}
        footer={
          activityProgress() ? (
            <TransferActivity
              progress={activityProgress()}
              snapshot={activity.snapshot()}
              cancelling={activity.cancelling()}
              cancellable={activity.cancellable()}
              onCancel={activity.cancel}
              dialogs={dialogs}
            />
          ) : undefined
        }
        isEjectPending={volumeRemoval.isPending}
        onActions={showVolumeMenu}
        onSelect={directory.selectVolume}
      />
      <main class="files-main">
        <FilesToolbar
          directory={directory}
          location={currentLocation()}
          selection={activeSelection()}
          labels={getExplorerLabels()}
          trashSelected={trashSelected()}
          busy={busy() || (trashSelected() && trash.loading())}
          readOnly={trashSelected() || busy() || readOnly() || loading()}
          onRefresh={() => (trashSelected() ? void trash.refresh() : refresh())}
          onNewFolder={promptCreateFolder}
          onNewFile={promptCreateFile}
          onOpenDisplayOptions={display.openOptions}
        />
        <Show
          when={!trashSelected()}
          fallback={
            <TrashView
              trash={trash}
              preferences={display.trashPreferences()}
              activateOnSingleClick={openWithSingleClick()}
              onBack={directory.goBack}
            />
          }
        >
          {selection.selectionMode() && (
            <SelectionActionBar
              selectedCount={selection.selectedPaths().length}
              itemCount={items().length}
              allItemsSelected={selection.allItemsSelected()}
              busy={activity.busy()}
              readOnly={readOnly() || loading()}
              onToggleAll={selection.toggleAll}
              onTransfer={startTransfer}
              onDelete={() => void deleteSelected()}
              deleteLabel={
                usesTrash(currentLocation())
                  ? t("files.moveToTrash")
                  : t("files.deletePermanently")
              }
            />
          )}

          {transfers.pendingTransfer() && !activity.busy() && (
            <TransferActionBar
              pendingTransfer={transfers.pendingTransfer()}
              readOnly={readOnly() || loading()}
              onComplete={() =>
                void transfers.completeTransfer(currentLocation())
              }
              onCancel={transfers.cancelPendingTransfer}
            />
          )}

          <FileList
            labels={getExplorerLabels(usesTrash(currentLocation()))}
            loading={loading()}
            items={items()}
            selectedItem={selectedItem()}
            selectedPaths={
              selection.selectionMode() ? selection.selectedPaths() : undefined
            }
            selectionMode={selection.selectionMode()}
            scrollToSelected={scrollToSelected()}
            viewStyle={displayPreferences().viewStyle}
            itemSize={displayPreferences().itemSize}
            onItemClick={handleExplorerItemClick}
            onItemFocus={selection.focusItem}
            onSelectionToggle={selection.toggleItem}
            onItemActivate={handleItemActivate}
            activateOnSingleClick={openWithSingleClick()}
            onItemContextMenu={handleItemContextMenu}
            onBackgroundContextMenu={handleBackgroundContextMenu}
            onItemDelete={
              selection.selectionMode() || readOnly()
                ? undefined
                : handleDeleteClick
            }
            onItemDeleteShortcut={
              selection.selectionMode() || readOnly()
                ? undefined
                : handleDeleteShortcut
            }
            onBack={directory.goBack}
            disabled={
              activity.busy() ||
              !volumes().some(
                (volume) =>
                  volume.id === currentVolume() && volume.state === "ready",
              )
            }
          />
        </Show>
        <DisplayOptionsModal
          labels={trashSelected() ? getTrashLabels() : getExplorerLabels()}
          show={display.showOptions()}
          preferences={
            trashSelected() ? display.trashPreferences() : displayPreferences()
          }
          onClose={display.closeOptions}
          onChange={(next) =>
            void handlePreferencesChange(next, trashSelected())
          }
        />
        <DialogHost dialogs={dialogs} />
      </main>
    </div>
  );
};

export default App;
