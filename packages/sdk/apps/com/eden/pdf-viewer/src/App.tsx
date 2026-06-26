import { filePicker } from "@edenapp/tablets";
import pdfiumWasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import EmbedPDF, {
  type DocumentManagerCapability,
  type DocumentManagerPlugin,
  type EmbedPdfContainer,
  type PluginRegistry,
  ZoomMode,
} from "@embedpdf/snippet";
import type { Component } from "solid-js";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import appIconUrl from "../icon.svg?url";
import { initLocale, t } from "./i18n";

interface FileOpenedEvent {
  path: string;
  isDirectory: boolean;
  appId: string;
}

type ViewerState =
  | { status: "empty" }
  | { status: "loading"; path: string }
  | { status: "ready"; path: string }
  | { status: "error"; path?: string; message: string };

function getFileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? t("pdfViewer.title");
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

async function getDocumentManager(
  registryPromise: Promise<PluginRegistry>,
): Promise<DocumentManagerCapability> {
  const registry = await registryPromise;
  const plugin = registry.getPlugin<DocumentManagerPlugin>("document-manager");
  const documentManager = plugin?.provides();

  if (!documentManager) {
    throw new Error(t("pdfViewer.unavailable"));
  }

  return documentManager;
}

const App: Component = () => {
  const [state, setState] = createSignal<ViewerState>({ status: "empty" });
  let viewerHost: HTMLDivElement | undefined;
  let viewer: EmbedPdfContainer | undefined;
  let registryPromise: Promise<PluginRegistry> | undefined;
  let loadVersion = 0;
  let openQueue = Promise.resolve();

  const currentPath = () => {
    const current = state();
    return "path" in current ? current.path : undefined;
  };

  const currentError = () => {
    const current = state();
    return current.status === "error" ? current.message : undefined;
  };

  const openPdfNow = async (path: string, version: number) => {
    if (!registryPromise) {
      throw new Error(t("pdfViewer.notInitialized"));
    }

    const documentManager = await getDocumentManager(registryPromise);
    if (version !== loadVersion) {
      return;
    }

    const base64Content = await window.edenAPI.shellCommand("fs/read", {
      path,
      encoding: "base64",
    });
    if (version !== loadVersion) {
      return;
    }

    await documentManager.closeAllDocuments().toPromise();
    if (version !== loadVersion) {
      return;
    }

    await documentManager
      .openDocumentBuffer({
        buffer: base64ToArrayBuffer(base64Content),
        name: getFileName(path),
        documentId: "eden-active-pdf",
        autoActivate: true,
      })
      .toPromise();
  };

  const openPdf = (path: string) => {
    const version = loadVersion + 1;
    loadVersion = version;
    setState({ status: "loading", path });

    openQueue = openQueue
      .then(() => openPdfNow(path, version))
      .then(() => {
        if (version !== loadVersion) {
          return;
        }

        setState({ status: "ready", path });
        window.edenFrame?.setTitle(getFileName(path));
      })
      .catch((error) => {
        if (version !== loadVersion) {
          return;
        }

        const message =
          error instanceof Error ? error.message : t("pdfViewer.failedToOpen");
        setState({ status: "error", path, message });
        window.edenFrame?.setTitle(t("pdfViewer.title"));
      });
  };

  const handleFileOpened = (data: FileOpenedEvent) => {
    if (!data.isDirectory && data.path) {
      openPdf(data.path);
    }
  };

  const openPdfFromPicker = async () => {
    try {
      const path = await filePicker.openFile({
        title: t("pdfViewer.openPdf"),
        filters: [{ name: t("pdfViewer.pdfDocuments"), extensions: ["pdf"] }],
      });

      if (path) {
        openPdf(path);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("pdfViewer.failedToOpen");
      setState({ status: "error", message });
      window.edenFrame?.setTitle(t("pdfViewer.title"));
    }
  };

  onMount(() => {
    initLocale();

    if (viewerHost) {
      viewer = EmbedPDF.init({
        type: "container",
        target: viewerHost,
        wasmUrl: pdfiumWasmUrl,
        fontFallback: { fonts: {} },
        fonts: {
          ui: null,
          signature: null,
        },
        tabBar: "never",
        documentManager: {
          maxDocuments: 1,
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
          "document-open",
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
    }

    const launchArgs = window.edenAPI.getLaunchArgs();
    if (launchArgs[0]) {
      openPdf(launchArgs[0]);
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

      void viewer?.registry.then((registry) => registry.destroy());
    });
  });

  return (
    <main class="pdf-viewer">
      <div ref={viewerHost} class="pdf-viewer__embed" />

      <Show when={state().status === "ready"}>
        <button
          type="button"
          class="eden-btn eden-btn-sm pdf-viewer__open-button"
          onClick={openPdfFromPicker}
        >
          {t("pdfViewer.openPdf")}
        </button>
      </Show>

      <Show when={state().status === "empty"}>
        <section class="pdf-viewer__state">
          <div class="pdf-viewer__message">
            <div class="pdf-viewer__icon">
              <img src={appIconUrl} alt="" aria-hidden="true" />
            </div>
            <h1>{t("pdfViewer.title")}</h1>
            <p>{t("pdfViewer.welcome")}</p>
            <button
              type="button"
              class="eden-btn eden-btn-primary eden-btn-md"
              onClick={openPdfFromPicker}
            >
              {t("pdfViewer.openPdf")}
            </button>
          </div>
        </section>
      </Show>

      <Show when={state().status === "loading"}>
        <section class="pdf-viewer__state">
          <div class="pdf-viewer__message">
            <div class="pdf-viewer__icon pdf-viewer__icon--loading">
              <img src={appIconUrl} alt="" aria-hidden="true" />
            </div>
            <h1>{t("pdfViewer.loading")}</h1>
            <p>{currentPath()}</p>
          </div>
        </section>
      </Show>

      <Show when={state().status === "error"}>
        <section class="pdf-viewer__state">
          <div class="pdf-viewer__message">
            <div class="pdf-viewer__icon pdf-viewer__icon--error">
              <img src={appIconUrl} alt="" aria-hidden="true" />
            </div>
            <h1>{t("pdfViewer.unableToOpen")}</h1>
            <p>{currentError()}</p>
            <button
              type="button"
              class="eden-btn eden-btn-primary eden-btn-md"
              onClick={openPdfFromPicker}
            >
              {t("pdfViewer.openPdf")}
            </button>
          </div>
        </section>
      </Show>
    </main>
  );
};

export default App;
