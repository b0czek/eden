import {
  buildBreadcrumbs,
  DisplayOptionsModal,
  type DisplayPreferences,
  FILES_APP_ID,
  FileExplorerHeader,
  type FileExplorerLabels,
  type FileItem,
  FileList,
  getParentPath,
  isValidName,
  joinPath,
  useExplorerNavigation,
  useFileActivationPreference,
} from "@edenapp/files-core";
import { createInterfaceScale } from "@edenapp/solid-kit";
import { notification, waitForEdenFrame } from "@edenapp/tablets";
import type {
  FilePickerFilter,
  FilePickerOpenEvent,
  FilePickerResult,
  FilesystemLocation,
  ViewBounds,
  WindowSize,
} from "@edenapp/types";
import type { Component } from "solid-js";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { initLocale, t } from "./i18n";

const HIDDEN_BOUNDS: ViewBounds = { x: 0, y: 0, width: 0, height: 0 };
const DEFAULT_PICKER_SIZE = { width: 760, height: 560 };
const VIEWPORT_MARGIN = 24;

type FilterOption =
  | { kind: "filter"; label: string; filter: FilePickerFilter }
  | { kind: "all-supported"; label: string; filters: FilePickerFilter[] }
  | { kind: "all-files"; label: string };

const getExplorerLabels = (): FileExplorerLabels => ({
  volume: t("filePicker.volume"),
  home: t("filePicker.home"),
  readOnly: t("filePicker.readOnly"),
  refresh: t("filePicker.refresh"),
  goBack: t("filePicker.goBack"),
  goForward: t("filePicker.goForward"),
  goUp: t("filePicker.goUp"),
  newFolder: t("filePicker.newFolder"),
  newFile: "",
  settings: t("common.settings"),
  editPath: t("filePicker.editPath"),
  searchPlaceholder: t("filePicker.searchPlaceholder"),
  loading: t("common.loading"),
  empty: t("filePicker.empty"),
  emptyHint: t("filePicker.emptyHint"),
  folder: t("filePicker.folder"),
  delete: t("common.delete"),
  close: t("common.close"),
  displayOptions: t("filePicker.displayOptions"),
  viewStyle: t("filePicker.viewStyle"),
  grid: t("filePicker.grid"),
  list: t("filePicker.list"),
  displaySize: t("filePicker.displaySize"),
  tiny: t("filePicker.tiny"),
  small: t("filePicker.small"),
  medium: t("filePicker.medium"),
  large: t("filePicker.large"),
  huge: t("filePicker.huge"),
  sortBy: t("filePicker.sortBy"),
  name: t("common.name"),
  size: t("common.size"),
  modified: t("filePicker.modified"),
  ascending: t("filePicker.ascending"),
  descending: t("filePicker.descending"),
});

const getFileName = (path: string) => path.split("/").filter(Boolean).at(-1);

const normalizeExtension = (extension: string) =>
  extension.replace(/^\./, "").toLowerCase();

const getExtension = (name: string) => {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === name.length - 1) return "";
  return name.slice(dotIndex + 1).toLowerCase();
};

const formatFilterLabel = (filter: FilePickerFilter) => {
  const extensions = filter.extensions
    ?.map((extension) => `*.${normalizeExtension(extension)}`)
    .join(", ");
  return extensions ? `${filter.name} (${extensions})` : filter.name;
};

const matchesFilter = (item: FileItem, filter: FilePickerFilter) => {
  if (item.isDirectory) return true;
  const extensions = filter.extensions?.map(normalizeExtension) ?? [];
  if (extensions.length === 0) return true;
  return extensions.includes(getExtension(item.name));
};

const matchesAnyFilter = (item: FileItem, filters: FilePickerFilter[]) =>
  filters.length === 0 || filters.some((filter) => matchesFilter(item, filter));

const calculateBounds = (
  windowSize: WindowSize,
  openerBounds?: ViewBounds,
  scale = 1,
): ViewBounds => {
  const viewportMargin = Math.round(VIEWPORT_MARGIN * scale);
  const width = Math.min(
    Math.round(DEFAULT_PICKER_SIZE.width * scale),
    Math.max(Math.round(320 * scale), windowSize.width - viewportMargin * 2),
  );
  const height = Math.min(
    Math.round(DEFAULT_PICKER_SIZE.height * scale),
    Math.max(Math.round(280 * scale), windowSize.height - viewportMargin * 2),
  );
  const preferredX = openerBounds
    ? openerBounds.x + (openerBounds.width - width) / 2
    : (windowSize.width - width) / 2;
  const preferredY = openerBounds
    ? openerBounds.y + (openerBounds.height - height) / 2
    : (windowSize.height - height) / 2;
  const maxX = Math.max(
    viewportMargin,
    windowSize.width - width - viewportMargin,
  );
  const maxY = Math.max(
    viewportMargin,
    windowSize.height - height - viewportMargin,
  );

  return {
    x: Math.round(Math.min(Math.max(preferredX, viewportMargin), maxX)),
    y: Math.round(Math.min(Math.max(preferredY, viewportMargin), maxY)),
    width: Math.round(width),
    height: Math.round(height),
  };
};

const getPickerTitle = (request: FilePickerOpenEvent) => {
  if (request.title) return request.title;
  if (request.mode === "save") return t("filePicker.titleSaveFile");
  if (request.selection === "directory")
    return t("filePicker.titleOpenDirectory");
  return t("filePicker.titleOpenFile");
};

const App: Component = () => {
  const interfaceScale = createInterfaceScale();
  const openWithSingleClick = useFileActivationPreference(FILES_APP_ID);
  const [activeRequest, setActiveRequest] =
    createSignal<FilePickerOpenEvent | null>(null);
  const [windowSize, setWindowSize] = createSignal<WindowSize | null>(null);
  const [selectedItem, setSelectedItem] = createSignal<string | null>(null);
  const [selectedPaths, setSelectedPaths] = createSignal<string[]>([]);
  const [scrollToSelected, setScrollToSelected] = createSignal(false);
  const [fileName, setFileName] = createSignal("");
  const [filterIndex, setFilterIndex] = createSignal(0);
  const [error, setError] = createSignal<string | null>(null);
  const [showDisplayOptionsModal, setShowDisplayOptionsModal] =
    createSignal(false);
  const [showNewFolderDialog, setShowNewFolderDialog] = createSignal(false);
  const [newFolderName, setNewFolderName] = createSignal("");
  const [pendingOverwritePath, setPendingOverwritePath] =
    createSignal<FilesystemLocation | null>(null);

  const [displayPreferences, setDisplayPreferences] =
    createSignal<DisplayPreferences>({
      viewStyle: "list",
      itemSize: "medium",
      sortBy: "name",
      sortOrder: "asc",
    });

  const sortItems = (itemsToSort: FileItem[]): FileItem[] => {
    const prefs = displayPreferences();

    return [...itemsToSort].sort((left, right) => {
      if (left.isDirectory && !right.isDirectory) return -1;
      if (!left.isDirectory && right.isDirectory) return 1;

      let comparison = 0;
      switch (prefs.sortBy) {
        case "name":
          comparison = left.name.localeCompare(right.name);
          break;
        case "size":
          comparison = left.size - right.size;
          break;
        case "modified":
          comparison = left.modified.getTime() - right.modified.getTime();
          break;
      }

      return prefs.sortOrder === "asc" ? comparison : -comparison;
    });
  };

  const {
    currentPath,
    currentVolume,
    volumes,
    readOnly,
    items,
    setItems,
    loading,
    navigationHistory,
    historyIndex,
    navigateTo,
    resetNavigation,
    goBack,
    goForward,
    goUp,
    refresh,
  } = useExplorerNavigation({
    active: () => activeRequest() !== null,
    allowedVolumes: () => activeRequest()?.allowedVolumes,
    onVolumeRemoved: () => {
      clearSelection();
      setPendingOverwritePath(null);
      setShowNewFolderDialog(false);
      setError(t("filePicker.volumeDisconnected"));
    },
    sortItems,
    onLoadError: setError,
    onPathUnavailable: (path, fallbackPath) => {
      void notification.push(
        t("filePicker.directoryUnavailableTitle"),
        fallbackPath
          ? t("filePicker.directoryUnavailableFallback", {
              path,
              fallbackPath,
            })
          : t("filePicker.directoryUnavailable", { path }),
        { type: "warning" },
      );
    },
    getLoadDirectoryErrorMessage: (loadError) =>
      `${t("filePicker.errors.loadDirectoryFailed")}: ${loadError.message}`,
    setSelectedItem,
    setScrollToSelected,
  });

  const filterOptions = createMemo<FilterOption[]>(() => {
    const filters = activeRequest()?.filters ?? [];
    if (filters.length === 0) {
      return [{ kind: "all-files", label: t("filePicker.allFiles") }];
    }

    return [
      {
        kind: "all-supported",
        label: t("filePicker.allSupportedFiles"),
        filters,
      },
      ...filters.map((filter) => ({
        kind: "filter" as const,
        label: formatFilterLabel(filter),
        filter,
      })),
      { kind: "all-files", label: t("filePicker.allFiles") },
    ];
  });

  const selectedFilterOption = createMemo(
    () => filterOptions()[filterIndex()] ?? filterOptions()[0],
  );

  const itemMatchesSelectedFilter = (item: FileItem) => {
    const option = selectedFilterOption();
    if (!option || option.kind === "all-files") return true;
    if (option.kind === "all-supported")
      return matchesAnyFilter(item, option.filters);
    return matchesFilter(item, option.filter);
  };

  const visibleItems = createMemo(() =>
    items().filter(
      (item) => item.isDirectory || itemMatchesSelectedFilter(item),
    ),
  );

  const allowMultiple = createMemo(() => {
    const request = activeRequest();
    return Boolean(request?.multiple && request.mode === "open");
  });

  const canSelectItem = (item: FileItem) => {
    const request = activeRequest();
    if (!request || loading() || (request.mode === "save" && readOnly()))
      return false;
    if (item.isDirectory) {
      return request.mode === "open" && request.selection === "directory";
    }
    if (request.selection === "directory") return false;
    return itemMatchesSelectedFilter(item);
  };

  const clearSelection = () => {
    setSelectedItem(null);
    setSelectedPaths([]);
    setScrollToSelected(false);
  };

  let previousPath = JSON.stringify([currentVolume(), currentPath()]);
  createEffect(() => {
    const nextPath = JSON.stringify([currentVolume(), currentPath()]);
    if (nextPath !== previousPath) {
      previousPath = nextPath;
      clearSelection();
      setError(null);
    }
  });

  createEffect(() => {
    if (filterIndex() >= filterOptions().length) {
      setFilterIndex(0);
    }
  });

  const handleDisplayPreferencesChange = (preferences: DisplayPreferences) => {
    setDisplayPreferences(preferences);
    const currentItems = items();
    if (currentItems.length > 0) {
      setItems(sortItems(currentItems));
    }
  };

  const getWindowSize = async () => {
    const cached = windowSize();
    if (cached) return cached;
    const size = await window.edenAPI.shellCommand("view/window-size", {});
    setWindowSize(size);
    return size;
  };

  const updateOverlayBounds = async (
    visible: boolean,
    request = activeRequest(),
  ) => {
    const bounds = visible
      ? calculateBounds(
          await getWindowSize(),
          request?.opener.bounds,
          interfaceScale(),
        )
      : HIDDEN_BOUNDS;

    await window.edenAPI.shellCommand("view/update-bounds", { bounds });
    if (visible) {
      await window.edenAPI.shellCommand("view/focus", {});
    }
  };

  const resolveInitialPath = async (request: FilePickerOpenEvent) => {
    const initialLocation = request.initialLocation ?? {
      volume: "home",
      path: "/",
    };
    const initialPath = initialLocation.path;
    try {
      const stats = await window.edenAPI.shellCommand("fs/stat", {
        location: { ...initialLocation },
      });
      if (stats.isDirectory) {
        return { directory: initialPath, name: request.suggestedName ?? "" };
      }
      return {
        directory: getParentPath(initialPath),
        name: request.suggestedName ?? getFileName(initialPath) ?? "",
        selectedPath: initialPath,
      };
    } catch {
      return { directory: "/", name: request.suggestedName ?? "" };
    }
  };

  const openPicker = async (request: FilePickerOpenEvent) => {
    setActiveRequest(request);
    setFilterIndex(0);
    setError(null);
    setShowDisplayOptionsModal(false);
    setShowNewFolderDialog(false);
    setPendingOverwritePath(null);
    clearSelection();

    const initial = await resolveInitialPath(request);
    setFileName(request.mode === "save" ? initial.name : "");
    resetNavigation(
      initial.directory,
      initial.selectedPath,
      request.initialLocation?.volume ?? "home",
    );
    if (initial.selectedPath && request.mode === "open") {
      setSelectedItem(initial.selectedPath);
      setSelectedPaths([initial.selectedPath]);
      setScrollToSelected(true);
    }

    await updateOverlayBounds(true, request);
  };

  const hidePicker = () => {
    setActiveRequest(null);
    setError(null);
    setFileName("");
    setShowDisplayOptionsModal(false);
    setShowNewFolderDialog(false);
    setPendingOverwritePath(null);
    clearSelection();
    void updateOverlayBounds(false, null);
  };

  const resolvePicker = async (result: Omit<FilePickerResult, "requestId">) => {
    const request = activeRequest();
    if (!request) return;

    try {
      await window.edenAPI.shellCommand("file-picker/resolve", {
        requestId: request.requestId,
        ...result,
      });
      hidePicker();
    } catch (resolveError) {
      setError(
        `${t("filePicker.errors.resolveFailed")}: ${
          (resolveError as Error).message
        }`,
      );
    }
  };

  const cancelPicker = () => resolvePicker({ reason: "cancel" });

  const appendDefaultExtension = (name: string) => {
    const option = selectedFilterOption();
    if (option?.kind !== "filter") return name;
    if (getExtension(name)) return name;
    const extension = option.filter.extensions?.[0];
    return extension ? `${name}.${normalizeExtension(extension)}` : name;
  };

  const confirmSave = async (replaceExisting = false) => {
    const request = activeRequest();
    const trimmedName = fileName().trim();
    if (readOnly() || loading()) return;
    if (!request || !trimmedName) {
      setError(t("filePicker.errors.noFileName"));
      return;
    }

    const path = joinPath(currentPath(), appendDefaultExtension(trimmedName));
    const location = { volume: currentVolume(), path };
    const directory = currentPath();
    if (request.overwritePrompt !== false && !replaceExisting) {
      const exists = await window.edenAPI.shellCommand("fs/exists", {
        location,
      });
      if (
        activeRequest()?.requestId !== request.requestId ||
        currentVolume() !== location.volume ||
        currentPath() !== directory
      )
        return;
      if (exists) {
        setPendingOverwritePath(location);
        return;
      }
    }

    await resolvePicker({ reason: "select", location, locations: [location] });
  };

  const confirmOpen = async () => {
    const request = activeRequest();
    if (!request) return;

    if (request.selection === "directory") {
      const paths =
        selectedPaths().length > 0 ? selectedPaths() : [currentPath()];
      await resolvePicker({
        reason: "select",
        location: { volume: currentVolume(), path: paths[0] },
        locations: paths.map((path) => ({ volume: currentVolume(), path })),
      });
      return;
    }

    const paths = selectedPaths();
    if (paths.length === 0) {
      setError(t("filePicker.errors.noSelection"));
      return;
    }

    await resolvePicker({
      reason: "select",
      location: { volume: currentVolume(), path: paths[0] },
      locations: paths.map((path) => ({ volume: currentVolume(), path })),
    });
  };

  const confirmSelection = () => {
    if (activeRequest()?.mode === "save") {
      void confirmSave();
    } else {
      void confirmOpen();
    }
  };

  const handleItemClick = (
    item: FileItem,
    event?: MouseEvent | KeyboardEvent,
  ) => {
    setError(null);
    setSelectedItem(item.location.path);
    setScrollToSelected(false);

    if (!canSelectItem(item)) {
      if (activeRequest()?.mode === "save" && item.isFile) {
        setFileName(item.name);
      }
      return;
    }

    const isToggle = Boolean(
      allowMultiple() &&
        event &&
        ("ctrlKey" in event || "metaKey" in event) &&
        (event.ctrlKey || event.metaKey),
    );

    if (isToggle) {
      setSelectedPaths((current) =>
        current.includes(item.location.path)
          ? current.filter((path) => path !== item.location.path)
          : [...current, item.location.path],
      );
      return;
    }

    setSelectedPaths([item.location.path]);
    if (activeRequest()?.mode === "save" && item.isFile) {
      setFileName(item.name);
    }
  };

  const handleItemActivate = (item: FileItem) => {
    if (item.isDirectory) {
      navigateTo(item.location.path);
      return;
    }

    if (activeRequest()?.mode === "open" && canSelectItem(item)) {
      setSelectedPaths([item.location.path]);
      void resolvePicker({
        reason: "select",
        location: { volume: item.location.volume, path: item.location.path },
        locations: [{ volume: item.location.volume, path: item.location.path }],
      });
    } else if (activeRequest()?.mode === "save") {
      setFileName(item.name);
    }
  };

  const submitNewFolder = async () => {
    const trimmedName = newFolderName().trim();
    if (!trimmedName || !isValidName(trimmedName)) {
      setError(t("filePicker.errors.invalidFolderName"));
      return;
    }

    if (readOnly() || loading()) return;
    const folderPath = joinPath(currentPath(), trimmedName);
    const location = { volume: currentVolume(), path: folderPath };
    try {
      const exists = await window.edenAPI.shellCommand("fs/exists", {
        location: { ...location },
      });
      if (exists) {
        setError(t("filePicker.errors.folderExists"));
        return;
      }

      await window.edenAPI.shellCommand("fs/mkdir", { location });
      setShowNewFolderDialog(false);
      setNewFolderName("");
      refresh();
    } catch (createError) {
      setError(
        `${t("filePicker.errors.createFolderFailed")}: ${
          (createError as Error).message
        }`,
      );
    }
  };

  createEffect(() => {
    const request = activeRequest();
    if (request) {
      window.edenFrame?.setTitle(getPickerTitle(request));
    } else {
      window.edenFrame?.resetTitle();
    }
  });

  let previousInterfaceScale = interfaceScale();
  createEffect(() => {
    const nextInterfaceScale = interfaceScale();
    if (
      nextInterfaceScale !== previousInterfaceScale &&
      activeRequest() !== null
    ) {
      void updateOverlayBounds(true);
    }
    previousInterfaceScale = nextInterfaceScale;
  });

  const confirmLabel = createMemo(() => {
    const request = activeRequest();
    if (!request) return t("filePicker.open");
    if (request.confirmLabel) return request.confirmLabel;
    if (request.mode === "save") return t("filePicker.save");
    if (request.selection === "directory") return t("filePicker.choose");
    return t("filePicker.open");
  });

  const canConfirm = createMemo(() => {
    const request = activeRequest();
    if (!request || loading() || (request.mode === "save" && readOnly()))
      return false;
    if (request.mode === "save") return fileName().trim().length > 0;
    if (request.selection === "directory") return true;
    return selectedPaths().length > 0;
  });

  const handleFrameClose = async () => {
    const request = activeRequest();
    if (!request) {
      await updateOverlayBounds(false, null);
      return;
    }

    await cancelPicker();
    if (activeRequest()?.requestId === request.requestId) {
      await window.edenAPI.shellCommand("file-picker/close", {
        requestId: request.requestId,
      });
    }
  };

  onMount(() => {
    initLocale();

    void waitForEdenFrame().then((frame) => {
      frame.close = handleFrameClose;
    });

    const handleOpened = (data: { picker: FilePickerOpenEvent }) => {
      void openPicker(data.picker);
    };
    const handleClosed = (result: FilePickerResult) => {
      if (activeRequest()?.requestId === result.requestId) {
        hidePicker();
      }
    };
    const handleBoundsChanged = (data: { windowSize: WindowSize }) => {
      setWindowSize(data.windowSize);
      if (activeRequest()) {
        void updateOverlayBounds(true);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!activeRequest()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        void cancelPicker();
      }
    };

    void (async () => {
      await window.edenAPI.subscribe("file-picker/opened", handleOpened);
      await window.edenAPI.subscribe("file-picker/closed", handleClosed);
      await window.edenAPI.subscribe(
        "view/global-bounds-changed",
        handleBoundsChanged,
      );
      await window.edenAPI.shellCommand("file-picker/register-display", {});
      await updateOverlayBounds(false, null);
    })();

    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      window.edenAPI.unsubscribe("file-picker/opened", handleOpened);
      window.edenAPI.unsubscribe("file-picker/closed", handleClosed);
      window.edenAPI.unsubscribe(
        "view/global-bounds-changed",
        handleBoundsChanged,
      );
      window.removeEventListener("keydown", handleKeyDown);
    });
  });

  return (
    <Show when={activeRequest()}>
      {(request) => (
        <div class="file-picker-window">
          <div class="file-explorer file-picker-explorer">
            <FileExplorerHeader
              labels={getExplorerLabels()}
              currentPath={currentPath()}
              currentVolume={currentVolume()}
              volumes={volumes()}
              readOnly={readOnly() || loading()}
              onRefresh={refresh}
              onVolumeChange={(volume) => {
                clearSelection();
                setPendingOverwritePath(null);
                setShowNewFolderDialog(false);
                resetNavigation("/", undefined, volume);
              }}
              historyIndex={historyIndex()}
              historyLength={navigationHistory().length}
              breadcrumbs={buildBreadcrumbs(currentPath())}
              onGoBack={goBack}
              onGoForward={goForward}
              onGoUp={goUp}
              onNavigate={navigateTo}
              onNewFolder={
                request().canCreateDirectories
                  ? () => {
                      setError(null);
                      setNewFolderName("");
                      setShowNewFolderDialog(true);
                    }
                  : undefined
              }
              onOpenDisplayOptions={() => setShowDisplayOptionsModal(true)}
            />

            <FileList
              labels={getExplorerLabels()}
              loading={loading()}
              items={visibleItems()}
              selectedItem={selectedItem()}
              selectedItems={selectedPaths()}
              scrollToSelected={scrollToSelected()}
              viewStyle={displayPreferences().viewStyle}
              itemSize={displayPreferences().itemSize}
              onItemClick={handleItemClick}
              onItemActivate={handleItemActivate}
              activateOnSingleClick={openWithSingleClick()}
              canActivateOnClick={(item) => item.isDirectory}
              onBack={goBack}
            />
          </div>

          <div class="file-picker-footer">
            <Show when={error()}>
              {(message) => <div class="file-picker-error">{message()}</div>}
            </Show>

            <div class="file-picker-footer-row">
              <div class="file-picker-footer-grid">
                <Show when={request().mode === "save"}>
                  <label class="file-picker-field">
                    <span>{t("filePicker.fileName")}</span>
                    <input
                      class="eden-input"
                      value={fileName()}
                      onInput={(event) =>
                        setFileName(event.currentTarget.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          confirmSelection();
                        }
                      }}
                    />
                  </label>
                </Show>

                <label class="file-picker-field">
                  <span>{t("filePicker.fileType")}</span>
                  <select
                    class="eden-select"
                    value={filterIndex()}
                    onChange={(event) =>
                      setFilterIndex(Number(event.currentTarget.value))
                    }
                  >
                    <For each={filterOptions()}>
                      {(option, index) => (
                        <option value={index()}>{option.label}</option>
                      )}
                    </For>
                  </select>
                </label>
              </div>

              <div class="file-picker-actions">
                <div class="file-picker-buttons">
                  <button
                    type="button"
                    class="eden-btn eden-btn-secondary eden-btn-md"
                    onClick={cancelPicker}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    class="eden-btn eden-btn-primary eden-btn-md"
                    disabled={!canConfirm()}
                    onClick={confirmSelection}
                  >
                    {confirmLabel()}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <DisplayOptionsModal
            labels={getExplorerLabels()}
            show={showDisplayOptionsModal()}
            preferences={displayPreferences()}
            onClose={() => setShowDisplayOptionsModal(false)}
            onChange={handleDisplayPreferencesChange}
          />

          <Show when={showNewFolderDialog()}>
            <div class="eden-modal-overlay">
              <div class="eden-modal file-picker-modal">
                <div class="eden-modal-header">
                  <h2 class="eden-modal-title">{t("filePicker.newFolder")}</h2>
                </div>
                <div class="eden-modal-body">
                  <label class="file-picker-field">
                    <span>{t("filePicker.folderName")}</span>
                    <input
                      class="eden-input"
                      value={newFolderName()}
                      autofocus
                      onInput={(event) =>
                        setNewFolderName(event.currentTarget.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void submitNewFolder();
                        }
                      }}
                    />
                  </label>
                </div>
                <div class="eden-modal-footer">
                  <button
                    type="button"
                    class="eden-btn eden-btn-secondary"
                    onClick={() => setShowNewFolderDialog(false)}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    class="eden-btn eden-btn-primary"
                    onClick={() => {
                      void submitNewFolder();
                    }}
                  >
                    {t("common.ok")}
                  </button>
                </div>
              </div>
            </div>
          </Show>

          <Show when={pendingOverwritePath()}>
            {(path) => (
              <div class="eden-modal-overlay">
                <div class="eden-modal file-picker-modal">
                  <div class="eden-modal-header">
                    <h2 class="eden-modal-title">
                      {t("filePicker.replaceExisting")}
                    </h2>
                  </div>
                  <div class="eden-modal-body">
                    <p>
                      {t("filePicker.replaceMessage", { path: path().path })}
                    </p>
                  </div>
                  <div class="eden-modal-footer">
                    <button
                      type="button"
                      class="eden-btn eden-btn-secondary"
                      onClick={() => setPendingOverwritePath(null)}
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="button"
                      class="eden-btn eden-btn-danger"
                      onClick={() => {
                        setPendingOverwritePath(null);
                        void confirmSave(true);
                      }}
                    >
                      {t("filePicker.replace")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
};

export default App;
