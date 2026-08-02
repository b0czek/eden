import {
  app,
  BrowserWindow,
  globalShortcut,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  MessageChannelMain,
  nativeTheme,
  screen,
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
  ShortcutPort,
  ThemeStatePort,
  UtilityProcessPort,
  WindowingPort,
} from "../ports";

class ElectronApplicationLifecycle implements ApplicationLifecyclePort {
  private quitRequested = false;
  private quitAllowed = false;

  appendCommandLineSwitch(name: string, value?: string): void {
    app.commandLine.appendSwitch(name, value);
  }

  getPath(name: "userData"): string {
    return app.getPath(name);
  }

  getAppPath(): string {
    return app.getAppPath();
  }

  whenReady(): Promise<void> {
    return app.whenReady();
  }

  quit(): void {
    app.quit();
  }

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
      if (this.quitAllowed) return;
      quitEvent.preventDefault();
      if (this.quitRequested) return;

      this.quitRequested = true;
      listener();
    };
    app.on("before-quit", handleQuitRequested);
    return () => app.removeListener("before-quit", handleQuitRequested);
  }

  completeQuit(): void {
    if (!this.quitRequested || this.quitAllowed) return;
    this.quitAllowed = true;
    app.quit();
  }
}

class ElectronWindowing implements WindowingPort {
  createWindow(options: PlatformWindowOptions): PlatformWindow {
    return new BrowserWindow(
      options as Electron.BrowserWindowConstructorOptions,
    ) as unknown as PlatformWindow;
  }

  createView(options: PlatformViewOptions): PlatformView {
    return new WebContentsView(
      options as Electron.WebContentsViewConstructorOptions,
    ) as unknown as PlatformView;
  }

  attachWebContentsLogger(
    contents: PlatformWebContents,
    context: Parameters<WindowingPort["attachWebContentsLogger"]>[1],
  ): void {
    attachWebContentsLogger(contents, context);
  }

  getWebContentsById(id: number): PlatformWebContents | undefined {
    return webContents.fromId(id) as unknown as PlatformWebContents | undefined;
  }
}

class ElectronRendererIpc implements RendererIpcPort {
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
  }

  on<TArgs extends unknown[]>(
    channel: string,
    listener: (event: RendererIpcEvent, ...args: TArgs) => void,
  ): void {
    ipcMain.on(channel, (event: IpcMainEvent, ...args: unknown[]) => {
      listener(event as RendererIpcEvent, ...(args as TArgs));
    });
  }

  removeHandler(channel: string): void {
    ipcMain.removeHandler(channel);
  }

  removeAllListeners(channel: string): void {
    ipcMain.removeAllListeners(channel);
  }
}

class ElectronUtilityProcesses implements UtilityProcessPort {
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
  }

  createMessageChannel(): {
    port1: PlatformMessagePort;
    port2: PlatformMessagePort;
  } {
    return new MessageChannelMain() as unknown as {
      port1: PlatformMessagePort;
      port2: PlatformMessagePort;
    };
  }
}

class ElectronAppChannels implements AppChannelPort {
  createMessageChannel(): {
    port1: PlatformMessagePort;
    port2: PlatformMessagePort;
  } {
    return new MessageChannelMain() as unknown as {
      port1: PlatformMessagePort;
      port2: PlatformMessagePort;
    };
  }

  getWebContentsById(id: number): PlatformWebContents | undefined {
    return webContents.fromId(id) as unknown as PlatformWebContents | undefined;
  }
}

class ElectronDisplay implements DisplayPort {
  getCursorScreenPoint(): { x: number; y: number } {
    return screen.getCursorScreenPoint();
  }

  getDisplayMatching(bounds: Bounds): { workArea: Bounds } {
    return screen.getDisplayMatching(bounds);
  }
}

class ElectronProcessMetrics implements ProcessMetricsPort {
  getAppMetrics(): ReturnType<ProcessMetricsPort["getAppMetrics"]> {
    return app.getAppMetrics();
  }
}

class ElectronShortcuts implements ShortcutPort {
  register(accelerator: string, callback: () => void): boolean {
    return globalShortcut.register(accelerator, callback);
  }

  unregister(accelerator: string): void {
    globalShortcut.unregister(accelerator);
  }

  unregisterAll(): void {
    globalShortcut.unregisterAll();
  }
}

class ElectronThemeState implements ThemeStatePort {
  get colorScheme(): "light" | "dark" | "system" {
    return nativeTheme.themeSource;
  }

  onChanged(listener: () => void): () => void {
    nativeTheme.on("updated", listener);
    return () => nativeTheme.removeListener("updated", listener);
  }
}

export function createElectronPlatform(): EdenPlatform {
  const windows = new ElectronWindowing();
  return {
    application: new ElectronApplicationLifecycle(),
    windows,
    rendererIpc: new ElectronRendererIpc(),
    utilityProcesses: new ElectronUtilityProcesses(),
    appChannels: new ElectronAppChannels(),
    display: new ElectronDisplay(),
    processMetrics: new ElectronProcessMetrics(),
    shortcuts: new ElectronShortcuts(),
    theme: new ElectronThemeState(),
  };
}
