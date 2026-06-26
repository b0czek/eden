import pdfiumWasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import EmbedPDF, {
  type DocumentManagerPlugin,
  type EmbedPdfContainer,
  type PluginRegistry,
  ZoomMode,
} from "@embedpdf/snippet";
import type { Component } from "solid-js";
import { onCleanup, onMount } from "solid-js";
import { initLocale, t } from "./i18n";
import {
  createPdfOpenController,
  disableEmbedPdfNativeFilePicker,
  getFileName,
  installEdenOpenFileDialog,
} from "./pdfOpen";

interface FileOpenedEvent {
  path: string;
  isDirectory: boolean;
  appId: string;
}

const MAX_OPEN_DOCUMENTS = 8;

const App: Component = () => {
  let viewerHost: HTMLDivElement | undefined;
  let viewer: EmbedPdfContainer | undefined;
  let registryPromise: Promise<PluginRegistry> | undefined;
  let removeNativeFilePickerPatch: (() => void) | undefined;

  const destroyViewer = () => {
    const viewerToDestroy = viewer;

    removeNativeFilePickerPatch?.();
    removeNativeFilePickerPatch = undefined;
    viewer = undefined;
    registryPromise = undefined;

    if (viewerHost) {
      viewerHost.replaceChildren();
    }

    void viewerToDestroy?.registry.then((registry) => registry.destroy());
  };

  const pdfOpen = createPdfOpenController({
    getRegistry: () => ensureViewer(),
    setLoading: () => {},
    setReady: (path) => {
      window.edenFrame?.setTitle(getFileName(path));
    },
    setError: () => {
      window.edenFrame?.setTitle(t("pdfViewer.title"));
    },
  });

  const registerEdenControls = async (registry: PluginRegistry) => {
    const documentManagerPlugin =
      registry.getPlugin<DocumentManagerPlugin>("document-manager");
    const documentManager = documentManagerPlugin?.provides();

    if (documentManagerPlugin) {
      installEdenOpenFileDialog(
        documentManagerPlugin,
        pdfOpen.openPdfFromPicker,
      );
    }

    const getActiveDocumentTitle = () => {
      const activeDocumentId = documentManager?.getActiveDocumentId();

      if (!activeDocumentId) {
        return undefined;
      }

      return documentManager?.getDocumentState(activeDocumentId)?.name;
    };

    documentManager?.onDocumentClosed(() => {
      if (documentManager.getDocumentCount() === 0) {
        window.edenFrame?.setTitle(t("pdfViewer.title"));
        return;
      }

      window.edenFrame?.setTitle(
        getActiveDocumentTitle() ?? t("pdfViewer.title"),
      );
    });

    documentManager?.onActiveDocumentChanged(() => {
      const activeDocumentTitle = getActiveDocumentTitle();

      if (activeDocumentTitle) {
        window.edenFrame?.setTitle(activeDocumentTitle);
      }
    });
  };

  const ensureViewer = async () => {
    if (registryPromise) {
      return registryPromise;
    }

    if (!viewerHost) {
      throw new Error(t("pdfViewer.notInitialized"));
    }

    viewer = EmbedPDF.init({
      type: "container",
      target: viewerHost,
      wasmUrl: pdfiumWasmUrl,
      fontFallback: { fonts: {} },
      fonts: {
        ui: null,
        signature: null,
      },
      tabBar: "always",
      documentManager: {
        maxDocuments: MAX_OPEN_DOCUMENTS,
      },
      pan: {
        defaultMode: "always",
      },
      zoom: {
        defaultZoomLevel: ZoomMode.FitWidth,
        minZoom: 0.25,
        maxZoom: 12,
      },
      disabledCategories: [
        "annotation",
        "document-capture",
        "document-close",
        "document-export",
        "document-fullscreen",
        "document-menu",
        "document-print",
        "document-protect",
        "form",
        "history",
        "insert",
        "panel-comment",
        "redaction",
      ],
    });
    registryPromise = viewer?.registry;

    if (!registryPromise) {
      throw new Error(t("pdfViewer.notInitialized"));
    }

    removeNativeFilePickerPatch = disableEmbedPdfNativeFilePicker(viewerHost);
    void registryPromise.then(registerEdenControls);

    return registryPromise;
  };

  const handleFileOpened = (data: FileOpenedEvent) => {
    if (!data.isDirectory && data.path) {
      pdfOpen.openPdf(data.path);
    }
  };

  onMount(() => {
    initLocale();

    void ensureViewer();

    const launchArgs = window.edenAPI.getLaunchArgs();
    if (launchArgs[0]) {
      pdfOpen.openPdf(launchArgs[0]);
    }

    void window.edenAPI.subscribe(
      "file/opened",
      handleFileOpened as (data: unknown) => void,
    );

    onCleanup(() => {
      void window.edenAPI.unsubscribe(
        "file/opened",
        handleFileOpened as (data: unknown) => void,
      );

      destroyViewer();
    });
  });

  return (
    <main class="pdf-viewer">
      <div ref={viewerHost} class="pdf-viewer__embed" />
    </main>
  );
};

export default App;
