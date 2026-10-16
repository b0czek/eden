import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  globalShortcut,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  MessageChannelMain,
  nativeTheme,
  net,
  protocol,
  screen,
  session,
  utilityProcess,
  WebContentsView,
  webContents,
} from "electron";
import { attachWebContentsLogger } from "../../logging/electron";
import type {
  AppChannelPort,
  ApplicationLifecycleEvent,
  ApplicationLifecyclePort,
  Bounds,
  DisplayPort,
  EdenPlatform,
  PlatformMessagePort,
  PlatformUtilityProcess,
  PlatformView,
  PlatformViewOptions,
  PlatformWebContents,
  PlatformWindow,
  PlatformWindowOptions,
  ProcessMetricsPort,
  RendererIpcEvent,
  RendererIpcPort,
  ResourceProtocolPort,
  ShortcutPort,
  ThemeStatePort,
  UtilityProcessPort,
  WindowingPort,
} from "../ports";

let privilegedSchemesRegistered = false;

function createElectronApplicationLifecycle(): ApplicationLifecyclePort {
  let quitRequested = false;
  let quitAllowed = false;
  return {
    appendCommandLineSwitch(name: string, value?: string): void {
      app.commandLine.appendSwitch(name, value);
    },
    getPath(name: "userData"): string {
      return app.getPath(name);
    },
    getAppPath(): string {
      return app.getAppPath();
    },
    whenReady(): Promise<void> {
      return app.whenReady();
    },
    quit(): void {
      app.quit();
    },
    on(event: ApplicationLifecycleEvent, listener: () => void): () => void {
      if (event !== "quit-requested") {
        if (event === "activate") {
          app.on("activate", listener);
          return () => app.removeListener("activate", listener);
        }
        app.on("window-all-closed", listener);
        return () => app.removeListener("window-all-closed", listener);
      }

      const handleQuitRequested = (quitEvent: Electron.Event) => {
        if (quitAllowed) return;
        quitEvent.preventDefault();
        if (quitRequested) return;

        quitRequested = true;
        listener();
      };
      app.on("before-quit", handleQuitRequested);
      return () => app.removeListener("before-quit", handleQuitRequested);
    },
    completeQuit(): void {
      if (!quitRequested || quitAllowed) return;
      quitAllowed = true;
      app.quit();
    },
  };
}

function createElectronWindowing(): WindowingPort {
  return {
    createWindow(options: PlatformWindowOptions): PlatformWindow {
      return new BrowserWindow(
        options as Electron.BrowserWindowConstructorOptions,
      ) as unknown as PlatformWindow;
    },
    createView(options: PlatformViewOptions): PlatformView {
      return new WebContentsView(
        options as Electron.WebContentsViewConstructorOptions,
      ) as unknown as PlatformView;
    },
    attachWebContentsLogger(
      contents: PlatformWebContents,
      context: Parameters<WindowingPort["attachWebContentsLogger"]>[1],
    ): void {
      attachWebContentsLogger(contents, context);
    },
    getWebContentsById(id: number): PlatformWebContents | undefined {
      return webContents.fromId(id) as unknown as
        | PlatformWebContents
        | undefined;
    },
  };
}

function createElectronRendererIpc(): RendererIpcPort {
  return {
    handle<TArgs extends unknown[], TResult>(
      channel: string,
      handler: (
        event: RendererIpcEvent,
        ...args: TArgs
      ) => TResult | Promise<TResult>,
    ): void {
      ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) =>
        handler(event as RendererIpcEvent, ...(args as TArgs)),
      );
    },
    on<TArgs extends unknown[]>(
      channel: string,
      listener: (event: RendererIpcEvent, ...args: TArgs) => void,
    ): void {
      ipcMain.on(channel, (event: IpcMainEvent, ...args: unknown[]) => {
        listener(event as RendererIpcEvent, ...(args as TArgs));
      });
    },
    removeHandler(channel: string): void {
      ipcMain.removeHandler(channel);
    },
    removeAllListeners(channel: string): void {
      ipcMain.removeAllListeners(channel);
    },
  };
}

function createElectronUtilityProcesses(): UtilityProcessPort {
  return {
    fork(
      modulePath: string,
      args: string[],
      options: Parameters<UtilityProcessPort["fork"]>[2],
    ): PlatformUtilityProcess {
      return utilityProcess.fork(
        modulePath,
        args,
        options,
      ) as unknown as PlatformUtilityProcess;
    },
    createMessageChannel(): {
      port1: PlatformMessagePort;
      port2: PlatformMessagePort;
    } {
      return new MessageChannelMain() as unknown as {
        port1: PlatformMessagePort;
        port2: PlatformMessagePort;
      };
    },
  };
}

function createElectronAppChannels(): AppChannelPort {
  return {
    createMessageChannel(): {
      port1: PlatformMessagePort;
      port2: PlatformMessagePort;
    } {
      return new MessageChannelMain() as unknown as {
        port1: PlatformMessagePort;
        port2: PlatformMessagePort;
      };
    },
    getWebContentsById(id: number): PlatformWebContents | undefined {
      return webContents.fromId(id) as unknown as
        | PlatformWebContents
        | undefined;
    },
  };
}

function createElectronDisplay(): DisplayPort {
  return {
    getCursorScreenPoint(): { x: number; y: number } {
      return screen.getCursorScreenPoint();
    },
    getDisplayMatching(bounds: Bounds): { workArea: Bounds } {
      return screen.getDisplayMatching(bounds);
    },
  };
}

function createElectronProcessMetrics(): ProcessMetricsPort {
  return {
    getAppMetrics(): ReturnType<ProcessMetricsPort["getAppMetrics"]> {
      return app.getAppMetrics();
    },
  };
}

function createElectronShortcuts(): ShortcutPort {
  return {
    register(accelerator: string, callback: () => void): boolean {
      return globalShortcut.register(accelerator, callback);
    },
    unregister(accelerator: string): void {
      globalShortcut.unregister(accelerator);
    },
    unregisterAll(): void {
      globalShortcut.unregisterAll();
    },
  };
}

function createElectronThemeState(): ThemeStatePort {
  return {
    get colorScheme(): "light" | "dark" | "system" {
      return nativeTheme.themeSource;
    },
    onChanged(listener: () => void): () => void {
      nativeTheme.on("updated", listener);
      return () => nativeTheme.removeListener("updated", listener);
    },
  };
}

function createElectronResourceProtocols(): ResourceProtocolPort {
  return {
    registerSchemes(schemes: string[]): void {
      if (privilegedSchemesRegistered) return;
      protocol.registerSchemesAsPrivileged(
        schemes.map((scheme) => ({
          scheme,
          privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            codeCache: true,
          },
        })),
      );
      privilegedSchemesRegistered = true;
    },
    handle(
      scheme: string,
      authorize: Parameters<ResourceProtocolPort["handle"]>[1],
      handler: Parameters<ResourceProtocolPort["handle"]>[2],
    ): void {
      const ses = session.defaultSession;
      const filter = { urls: [`${scheme}://*/*`] };
      ses.webRequest.onBeforeRequest(filter, (details, callback) => {
        callback({
          cancel: !authorize({
            url: details.url,
            method: details.method,
            webContentsId: details.webContentsId,
          }),
        });
      });
      void ses.protocol.handle(scheme, async (request) => {
        const response = await handler({
          url: request.url,
          method: request.method,
        });
        if (!response.filePath) {
          return new Response(null, {
            status: response.status,
            headers: response.headers,
          });
        }
        const fileResponse = await net.fetch(
          pathToFileURL(response.filePath).href,
        );
        const headers = new Headers(fileResponse.headers);
        for (const [name, value] of Object.entries(response.headers ?? {})) {
          headers.set(name, value);
        }
        return new Response(
          request.method === "HEAD" ? null : fileResponse.body,
          {
            status: response.status,
            headers,
          },
        );
      });
    },
    unhandle(scheme: string): void {
      const ses = session.defaultSession;
      ses.webRequest.onBeforeRequest({ urls: [`${scheme}://*/*`] }, null);
      if (ses.protocol.isProtocolHandled(scheme)) {
        void ses.protocol.unhandle(scheme);
      }
    },
  };
}

export function createElectronPlatform(): EdenPlatform {
  const windows = createElectronWindowing();
  return {
    application: createElectronApplicationLifecycle(),
    windows,
    rendererIpc: createElectronRendererIpc(),
    utilityProcesses: createElectronUtilityProcesses(),
    appChannels: createElectronAppChannels(),
    display: createElectronDisplay(),
    processMetrics: createElectronProcessMetrics(),
    shortcuts: createElectronShortcuts(),
    theme: createElectronThemeState(),
    resources: createElectronResourceProtocols(),
  };
}
