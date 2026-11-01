import * as eden from "@edenapp/client";
import {
  DisplayOptionsModal,
  type FileItem,
  FileList,
  joinPath,
  useFileActivationPreference,
  useVolumeEject,
} from "@edenapp/files-core";
import { createDialogs, DialogHost } from "@edenapp/solid-kit/dialogs";
import { notification } from "@edenapp/tablets";
import type { FileOpenedEvent } from "@edenapp/types";
import type { Component } from "solid-js";
import {
  createEffect,
  createMemo,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import {
  SelectionActionBar,
  TransferActionBar,
} from "./components/FileModeActionBars";
import { FilePlaces } from "./components/FilePlaces";
import { FilesToolbar } from "./components/FilesToolbar";
import { TransferActivity } from "./components/TransferActivity";
import { TrashView } from "./components/TrashView";
import { TRASH_DIRECTORY } from "./features/trash";
import { useDirectoryBrowser } from "./features/useDirectoryBrowser";
import { useDisplayPreferences } from "./features/useDisplayPreferences";
import { useExplorerContextMenus } from "./features/useExplorerContextMenus";
import { useFileActions } from "./features/useFileActions";
import { useFileErrors } from "./features/useFileErrors";
import { useFilesKeyboardShortcuts } from "./features/useFilesKeyboardShortcuts";
import { useFileTransfers } from "./features/useFileTransfers";
import { usePinnedFolders } from "./features/usePinnedFolders";
import { useTrash } from "./features/useTrash";
import { useTrashBrowser } from "./features/useTrashBrowser";
import { getExplorerLabels, initLocale, t } from "./i18n";

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
      transfers.cancelTransfer();
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
    items,
    selection,
    selectedItem,
    setSelectedItem,
    scrollToSelected,
    setScrollToSelected,
    isTrashItem,
    openTrash,
    navigate: navigateWithSelectionClear,
    goBack: goBackWithSelectionClear,
  } = directory;
  const {
    currentPath,
    currentVolume,
    currentLocation,
    currentPage,
    pageLocation: trashLocation,
    accessScope,
    volumes,
    readOnly,
    setItems,
    loading,
    refresh,
  } = navigation;
  const trashSelected = () => currentPage() === "trash";
  const {
    selectionMode,
    selectedPaths,
    selectedFiles,
    allItemsSelected,
    exit: exitSelectionMode,
    focusItem: setFocusedItem,
    toggleItem: toggleItemSelection,
    selectAll: selectAllItems,
    toggleAll: toggleAllItems,
  } = selection;

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
    refresh,
    dialogs,
    showError,
    showFailures,
    isBlocked: () => trash.busy(),
  });

  const homeTrashRoot = createMemo(() => {
    const scope = accessScope("home");
    return scope === undefined
      ? undefined
      : { volume: "home", path: joinPath(scope, TRASH_DIRECTORY) };
  });
  const trash = useTrash({
    dialogs,
    isBusy: () => transfers.busy() || Boolean(transfers.pendingTransfer()),
    onChanged: refresh,
    showError,
    showFailures,
    active: trashSelected,
    root: () => trashLocation() ?? homeTrashRoot(),
    volumes,
  });
  createEffect(
    on(
      transfers.busy,
      (busy) => {
        if (!busy && trashSelected()) void trash.refresh();
      },
      { defer: true },
    ),
  );

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
    navigateTo: navigateWithSelectionClear,
    operations: transfers.operations,
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
      isTrashItem(item) &&
      (selectionMode() || event?.ctrlKey || event?.metaKey || event?.shiftKey)
    )
      return;
    if (
      selectionMode() ||
      event?.ctrlKey ||
      event?.metaKey ||
      event?.shiftKey
    ) {
      toggleItemSelection(item, event);
      return;
    }
    handleSingleItemClick(item);
  };

  const startTransfer = (
    operation: "copy" | "move",
    selected = selectedFiles(),
  ) => {
    if (trashSelected() || trash.busy()) return;
    selected = selected.filter((item) => !isTrashItem(item));
    if (operation === "move" && readOnly()) return;
    if (transfers.beginTransfer(operation, selected)) exitSelectionMode();
  };

  const deleteSelected = async () => {
    if (trashSelected() || trash.busy() || readOnly()) return;
    const selected = selectedFiles();
    if (await transfers.deleteItems(selected)) exitSelectionMode();
  };

  const shortcutItems = () => {
    if (selectionMode()) return selectedFiles();
    const path = selectedItem();
    if (!path) return [];
    const item = items().find((candidate) => candidate.location.path === path);
    return item && !isTrashItem(item) ? [item] : [];
  };

  const { handleItemContextMenu, handleBackgroundContextMenu, showVolumeMenu } =
    useExplorerContextMenus({
      volumes,
      isTrashItem,
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
      copyItem: (item) => {
        startTransfer("copy", [item]);
      },
      moveItem: (item) => {
        startTransfer("move", [item]);
      },
      readOnly,
      isBusy: () =>
        trash.busy() ||
        transfers.busy() ||
        Boolean(transfers.pendingTransfer()),
      clearSelection: exitSelectionMode,
    });

  useFilesKeyboardShortcuts({
    busy: () => trashSelected() || trash.busy() || transfers.busy(),
    hasPendingTransfer: () => Boolean(transfers.pendingTransfer()),
    selectionMode,
    selectedCount: () => selectedPaths().length,
    shortcutItems,
    displayPreferences,
    cancelTransfer: transfers.cancelTransfer,
    exitSelection: exitSelectionMode,
    selectAll: selectAllItems,
    startTransfer,
    deleteSelected,
    changePreferences: handlePreferencesChange,
  });

  const trashBrowser = useTrashBrowser({
    trash,
    dialogs,
    get disabled() {
      return transfers.busy() || Boolean(transfers.pendingTransfer());
    },
    get location() {
      return trashLocation();
    },
    get labels() {
      return getExplorerLabels();
    },
    sortItems: display.sortTrashItems,
    active: trashSelected,
  });
  const toolbarLocation = () =>
    trashSelected()
      ? (trashLocation() ?? {
          volume: "home",
          path: joinPath(accessScope("home") ?? "/", TRASH_DIRECTORY),
        })
      : currentLocation();
  const toolbarSelection = () =>
    trashSelected() ? trashBrowser.selection : selection;
  const toolbarLabels = () =>
    trashSelected() ? trashBrowser.labels() : getExplorerLabels();
  const toolbarBusy = () =>
    trash.busy() ||
    transfers.busy() ||
    Boolean(transfers.pendingTransfer()) ||
    (trashSelected() && trash.loading());
  const activity = () =>
    trash.progress() ??
    (transfers.showProgress() ? transfers.progress() : null);

  return (
    <div class="file-explorer files-layout">
      <FilePlaces
        volumes={volumes()}
        currentLocation={currentLocation()}
        trashSelected={trashSelected()}
        onSelectTrash={() => openTrash()}
        onTrashActions={(position) =>
          void trash.showSidebarMenu(homeTrashRoot(), position)
        }
        pins={pinned.pins()}
        pinCurrentDisabled={
          trashSelected() ||
          loading() ||
          transfers.busy() ||
          !pinned.canPin(currentLocation())
        }
        onPinCurrent={() => void pinCurrentFolder()}
        onSelectPin={(pin) => void directory.openPinnedFolder(pin.location)}
        onPinActions={pinned.showMenu}
        footer={
          activity() ? (
            <TransferActivity
              progress={activity()}
              snapshot={trash.busy() ? trash.snapshot() : transfers.snapshot()}
              cancelling={transfers.cancelling()}
              onCancel={transfers.cancelTransfer}
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
          location={toolbarLocation()}
          selection={toolbarSelection()}
          labels={toolbarLabels()}
          trashSelected={trashSelected()}
          busy={toolbarBusy()}
          readOnly={trashSelected() || trash.busy() || readOnly() || loading()}
          onRefresh={() => (trashSelected() ? void trash.refresh() : refresh())}
          onNewFolder={promptCreateFolder}
          onNewFile={promptCreateFile}
          onOpenDisplayOptions={display.openOptions}
        />
        <Show when={trashSelected()}>
          <TrashView
            trash={trash}
            browser={trashBrowser}
            preferences={displayPreferences()}
            activateOnSingleClick={openWithSingleClick()}
            onBack={goBackWithSelectionClear}
          />
        </Show>
        <Show when={!trashSelected()}>
          {selectionMode() && (
            <SelectionActionBar
              selectedCount={selectedPaths().length}
              itemCount={items().filter((item) => !isTrashItem(item)).length}
              allItemsSelected={allItemsSelected()}
              busy={trash.busy() || transfers.busy()}
              readOnly={readOnly() || loading()}
              onToggleAll={toggleAllItems}
              onTransfer={startTransfer}
              onDelete={() => void deleteSelected()}
              deleteLabel={
                currentVolume() === "home"
                  ? t("files.moveToTrash")
                  : t("files.deletePermanently")
              }
            />
          )}

          {transfers.pendingTransfer() && !transfers.busy() && (
            <TransferActionBar
              pendingTransfer={transfers.pendingTransfer()}
              readOnly={readOnly() || loading()}
              onComplete={() =>
                void transfers.completeTransfer(currentLocation())
              }
              onCancel={transfers.cancelTransfer}
            />
          )}

          <FileList
            labels={getExplorerLabels(currentVolume())}
            loading={loading()}
            items={items()}
            canSelectItem={(item) => !isTrashItem(item)}
            canDeleteItem={(item) => !isTrashItem(item)}
            selectedItem={selectedItem()}
            selectedPaths={selectionMode() ? selectedPaths() : undefined}
            selectionMode={selectionMode()}
            scrollToSelected={scrollToSelected()}
            viewStyle={displayPreferences().viewStyle}
            itemSize={displayPreferences().itemSize}
            onItemClick={handleExplorerItemClick}
            onItemFocus={setFocusedItem}
            onSelectionToggle={(item, event) => {
              if (!isTrashItem(item)) toggleItemSelection(item, event);
            }}
            onItemActivate={handleItemActivate}
            activateOnSingleClick={openWithSingleClick()}
            onItemContextMenu={handleItemContextMenu}
            onBackgroundContextMenu={handleBackgroundContextMenu}
            onItemDelete={
              selectionMode() || readOnly() ? undefined : handleDeleteClick
            }
            onItemDeleteShortcut={
              selectionMode() || readOnly()
                ? undefined
                : (item) => {
                    if (!isTrashItem(item)) handleDeleteShortcut(item);
                  }
            }
            onBack={goBackWithSelectionClear}
            disabled={
              trash.busy() ||
              transfers.busy() ||
              !volumes().some(
                (volume) =>
                  volume.id === currentVolume() && volume.state === "ready",
              )
            }
          />
        </Show>
        <DisplayOptionsModal
          labels={toolbarLabels()}
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
