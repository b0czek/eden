import { filePicker } from "@edenapp/tablets";
import {
  type DocumentManagerCapability,
  type DocumentManagerPlugin,
  type PluginRegistry,
} from "@embedpdf/snippet";
import { t } from "./i18n";

export type OpenFileDialogOptions = Parameters<
  DocumentManagerCapability["openFileDialog"]
>[0];
type OpenFileDialogTask = ReturnType<
  DocumentManagerCapability["openFileDialog"]
>;
type OpenFileDialogResult = Awaited<
  ReturnType<OpenFileDialogTask["toPromise"]>
>;
type OpenFileRequest = Parameters<
  DocumentManagerPlugin["onOpenFileRequest"]
>[0] extends (event: infer Event) => unknown
  ? Event
  : never;
type OpenFileRequestError = Parameters<OpenFileRequest["task"]["reject"]>[0];

interface PdfOpenControllerOptions {
  getRegistry: () => Promise<PluginRegistry>;
  setLoading: (path: string) => void;
  setReady: (path: string) => void;
  setError: (path: string | undefined, message: string) => void;
}

export function getFileName(path: string): string {
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

function pushWarningToast(message: string) {
  void window.edenAPI
    .shellCommand("notification/push", {
      title: t("pdfViewer.title"),
      message,
      type: "warning",
      timeout: 5000,
    })
    .catch((error) => {
      console.warn("Failed to show PDF viewer notification", error);
    });
}

function getDocumentManager(
  registry: PluginRegistry,
): DocumentManagerCapability {
  const plugin = registry.getPlugin<DocumentManagerPlugin>("document-manager");
  const documentManager = plugin?.provides();

  if (!documentManager) {
    throw new Error(t("pdfViewer.unavailable"));
  }

  return documentManager;
}

export function installEdenOpenFileDialog(
  documentManagerPlugin: DocumentManagerPlugin,
  openPdfFromPicker: (
    options?: OpenFileDialogOptions,
  ) => Promise<OpenFileDialogResult | undefined>,
) {
  return documentManagerPlugin.onOpenFileRequest(
    ({ task, options }: OpenFileRequest) => {
      void openPdfFromPicker(options)
        .then((result) => {
          if (result) {
            task.resolve(result);
            return;
          }

          const cancelled: OpenFileRequestError = {
            code: 9,
            message: "File selection cancelled.",
          };
          task.reject(cancelled);
        })
        .catch((error) => {
          task.reject(error);
        });
    },
  );
}

export function disableEmbedPdfNativeFilePicker(host: HTMLElement) {
  const patchedInputs = new Map<HTMLInputElement, HTMLInputElement["click"]>();
  let shadowRoot: ShadowRoot | undefined;
  let shadowObserver: MutationObserver | undefined;

  const patchInput = (input: HTMLInputElement) => {
    if (patchedInputs.has(input)) {
      return;
    }

    patchedInputs.set(input, input.click.bind(input));
    input.disabled = true;
    Object.defineProperty(input, "click", {
      configurable: true,
      value: () => {},
    });
  };

  const patchShadowRootInputs = () => {
    if (!shadowRoot) {
      return;
    }

    shadowRoot
      .querySelectorAll<HTMLInputElement>(
        'input[type="file"][accept="application/pdf"]',
      )
      .forEach(patchInput);
  };

  const connectShadowRoot = () => {
    if (shadowRoot) {
      patchShadowRootInputs();
      return;
    }

    const embedContainer = host.querySelector("embedpdf-container");
    shadowRoot = embedContainer?.shadowRoot ?? undefined;

    if (!shadowRoot) {
      return;
    }

    patchShadowRootInputs();
    shadowObserver = new MutationObserver(patchShadowRootInputs);
    shadowObserver.observe(shadowRoot, {
      childList: true,
      subtree: true,
    });
  };

  connectShadowRoot();
  const hostObserver = new MutationObserver(() => {
    connectShadowRoot();
  });

  hostObserver.observe(host, {
    childList: true,
    subtree: true,
  });

  return () => {
    hostObserver.disconnect();
    shadowObserver?.disconnect();
    shadowObserver = undefined;
    shadowRoot = undefined;

    patchedInputs.forEach((click, input) => {
      input.disabled = false;
      Object.defineProperty(input, "click", {
        configurable: true,
        value: click,
      });
    });
    patchedInputs.clear();
  };
}

export function createPdfOpenController({
  getRegistry,
  setLoading,
  setReady,
  setError,
}: PdfOpenControllerOptions) {
  let loadVersion = 0;
  let openQueue: Promise<OpenFileDialogResult | undefined> =
    Promise.resolve(undefined);

  const openPdfNow = async (
    path: string,
    version: number,
    options?: OpenFileDialogOptions,
  ) => {
    const registry = await getRegistry();
    const documentManager = await getDocumentManager(registry);
    if (version !== loadVersion) {
      return undefined;
    }

    const base64Content = await window.edenAPI.shellCommand("fs/read", {
      path,
      encoding: "base64",
    });
    if (version !== loadVersion) {
      return undefined;
    }

    return documentManager
      .openDocumentBuffer({
        buffer: base64ToArrayBuffer(base64Content),
        name: getFileName(path),
        documentId:
          options?.documentId ??
          `eden-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        scale: options?.scale,
        rotation: options?.rotation,
        autoActivate: options?.autoActivate ?? true,
        permissions: options?.permissions,
      })
      .toPromise();
  };

  const openPdf = (path: string, options?: OpenFileDialogOptions) => {
    const version = loadVersion + 1;
    loadVersion = version;

    setLoading(path);

    openQueue = openQueue
      .then(() => openPdfNow(path, version, options))
      .then((result) => {
        if (version !== loadVersion) {
          return undefined;
        }

        setReady(path);
        return result;
      })
      .catch((error) => {
        if (version !== loadVersion) {
          return undefined;
        }

        const message =
          error instanceof Error ? error.message : t("pdfViewer.failedToOpen");
        pushWarningToast(message);
        setError(path, message);
        return undefined;
      });

    return openQueue;
  };

  const openPdfFromPicker = async (options?: OpenFileDialogOptions) => {
    try {
      const path = await filePicker.openFile({
        title: t("pdfViewer.openPdf"),
        filters: [{ name: t("pdfViewer.pdfDocuments"), extensions: ["pdf"] }],
      });

      if (path) {
        return openPdf(path, options);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("pdfViewer.failedToOpen");
      setError(undefined, message);
    }

    return undefined;
  };

  return {
    openPdf,
    openPdfFromPicker,
  };
}
