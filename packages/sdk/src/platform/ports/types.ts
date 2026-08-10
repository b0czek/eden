import type { LogContext } from "../../logging";

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlatformMessagePort {
  close(): void;
}

export type PlatformListener = (...args: never[]) => unknown;

export interface PlatformWebRequest {
  onHeadersReceived(
    filter: { urls: string[] },
    listener: (
      details: { responseHeaders?: Record<string, string[]> },
      callback: (response: {
        responseHeaders?: Record<string, string[]>;
      }) => void,
    ) => void,
  ): void;
}

export interface PlatformProtocolRequest {
  url: string;
  method: string;
  webContentsId?: number;
}

export interface PlatformProtocolResponse {
  status: number;
  filePath?: string;
  headers?: Record<string, string>;
}

export interface ResourceProtocolPort {
  /**
   * Declare custom URL schemes before the platform becomes ready so the
   * renderer treats them as secure, standard schemes. This does not attach a
   * request handler; runtime managers do that later through `handle`.
   */
  registerSchemes(schemes: string[]): void;
  handle(
    scheme: string,
    authorize: (request: PlatformProtocolRequest) => boolean,
    handler: (
      request: PlatformProtocolRequest,
    ) => Promise<PlatformProtocolResponse>,
  ): void;
  unhandle(scheme: string): void;
}

export interface PlatformWebContents {
  readonly id: number;
  readonly session: { webRequest: PlatformWebRequest };
  on<TListener extends PlatformListener>(
    event: string,
    listener: TListener,
  ): this;
  once<TListener extends PlatformListener>(
    event: string,
    listener: TListener,
  ): this;
  removeListener<TListener extends PlatformListener>(
    event: string,
    listener: TListener,
  ): this;
  isDestroyed(): boolean;
  close(): void;
  focus(): void;
  send(channel: string, ...args: unknown[]): void;
  postMessage(
    channel: string,
    message: unknown,
    ports?: PlatformMessagePort[],
  ): void;
  loadURL(url: string): Promise<void>;
  loadFile(filePath: string): Promise<void>;
  insertCSS(css: string): Promise<string>;
  executeJavaScript<T = unknown>(code: string): Promise<T>;
  getZoomFactor(): number;
  setZoomFactor(factor: number): void;
  getOSProcessId(): number;
  isDevToolsOpened(): boolean;
  openDevTools(): void;
  closeDevTools(): void;
  setWindowOpenHandler(handler: () => { action: "allow" | "deny" }): void;
}

export interface PlatformView {
  readonly webContents: PlatformWebContents;
  setBounds(bounds: Bounds): void;
  getBounds(): Bounds;
}

export interface PlatformWindow {
  readonly webContents: PlatformWebContents;
  readonly contentView: {
    addChildView(view: PlatformView): void;
    removeChildView(view: PlatformView): void;
  };
  on<TListener extends PlatformListener>(
    event: string,
    listener: TListener,
  ): this;
  once<TListener extends PlatformListener>(
    event: string,
    listener: TListener,
  ): this;
  removeListener<TListener extends PlatformListener>(
    event: string,
    listener: TListener,
  ): this;
  loadFile(filePath: string): Promise<void>;
  isDestroyed(): boolean;
  destroy(): void;
  close(): void;
  show(): void;
  showInactive(): void;
  hide(): void;
  focus(): void;
  isVisible(): boolean;
  getBounds(): Bounds;
  getContentBounds(): Bounds;
  setBounds(bounds: Bounds): void;
  setMovable(movable: boolean): void;
  setAlwaysOnTop(flag: boolean, level?: string): void;
  setVisibleOnAllWorkspaces(
    visible: boolean,
    options?: { visibleOnFullScreen?: boolean },
  ): void;
}

export interface PlatformWebPreferences {
  nodeIntegration?: boolean;
  contextIsolation?: boolean;
  sandbox?: boolean;
  preload?: string;
  additionalArguments?: string[];
  transparent?: boolean;
  backgroundThrottling?: boolean;
  scrollBounce?: boolean;
  spellcheck?: boolean;
}

export interface PlatformWindowOptions {
  parent?: PlatformWindow;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  minWidth?: number;
  minHeight?: number;
  title?: string;
  icon?: string;
  backgroundColor?: string;
  autoHideMenuBar?: boolean;
  show?: boolean;
  frame?: boolean;
  transparent?: boolean;
  resizable?: boolean;
  movable?: boolean;
  minimizable?: boolean;
  maximizable?: boolean;
  fullscreenable?: boolean;
  skipTaskbar?: boolean;
  hasShadow?: boolean;
  focusable?: boolean;
  webPreferences?: PlatformWebPreferences;
}

export interface PlatformViewOptions {
  webPreferences: PlatformWebPreferences;
}

export interface WindowingPort {
  createWindow(options: PlatformWindowOptions): PlatformWindow;
  createView(options: PlatformViewOptions): PlatformView;
  attachWebContentsLogger(
    webContents: PlatformWebContents,
    context: LogContext,
  ): void;
  getWebContentsById(id: number): PlatformWebContents | undefined;
}

export interface RendererIpcEvent {
  sender: { id: number };
}

export interface RendererIpcPort {
  handle<TArgs extends unknown[], TResult>(
    channel: string,
    handler: (
      event: RendererIpcEvent,
      ...args: TArgs
    ) => TResult | Promise<TResult>,
  ): void;
  on<TArgs extends unknown[]>(
    channel: string,
    listener: (event: RendererIpcEvent, ...args: TArgs) => void,
  ): void;
  removeHandler(channel: string): void;
  removeAllListeners(channel: string): void;
}

export interface PlatformUtilityProcess {
  readonly pid: number;
  readonly stdout?: {
    on(event: "data", listener: (chunk: Buffer | string) => void): void;
  } | null;
  readonly stderr?: {
    on(event: "data", listener: (chunk: Buffer | string) => void): void;
  } | null;
  on<TListener extends PlatformListener>(
    event: string,
    listener: TListener,
  ): this;
  once<TListener extends PlatformListener>(
    event: string,
    listener: TListener,
  ): this;
  removeListener<TListener extends PlatformListener>(
    event: string,
    listener: TListener,
  ): this;
  postMessage(message: unknown, ports?: PlatformMessagePort[]): void;
  kill(): boolean;
}

export interface UtilityProcessPort {
  fork(
    modulePath: string,
    args: string[],
    options: {
      serviceName: string;
      stdio: ["ignore", "pipe", "pipe"];
      env: NodeJS.ProcessEnv;
    },
  ): PlatformUtilityProcess;
  createMessageChannel(): {
    port1: PlatformMessagePort;
    port2: PlatformMessagePort;
  };
}

export interface AppChannelPort {
  createMessageChannel(): {
    port1: PlatformMessagePort;
    port2: PlatformMessagePort;
  };
  getWebContentsById(id: number): PlatformWebContents | undefined;
}

export interface PlatformDisplay {
  workArea: Bounds;
}

export interface DisplayPort {
  getCursorScreenPoint(): { x: number; y: number };
  getDisplayMatching(bounds: Bounds): PlatformDisplay;
}

export interface PlatformProcessMetric {
  pid: number;
  creationTime: number;
  type: string;
  serviceName?: string;
  name?: string;
  cpu: {
    percentCPUUsage: number;
    cumulativeCPUUsage?: number;
    idleWakeupsPerSecond?: number;
  };
  memory: {
    workingSetSize: number;
    peakWorkingSetSize: number;
    privateBytes?: number;
  };
}

export interface ProcessMetricsPort {
  getAppMetrics(): PlatformProcessMetric[];
}

export interface ShortcutPort {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
  unregisterAll(): void;
}

export interface ThemeStatePort {
  get colorScheme(): "light" | "dark" | "system";
  onChanged(listener: () => void): () => void;
}

export type ApplicationLifecycleEvent =
  | "window-all-closed"
  | "activate"
  | "quit-requested";

export interface ApplicationLifecyclePort {
  appendCommandLineSwitch(name: string, value?: string): void;
  getPath(name: "userData"): string;
  getAppPath(): string;
  whenReady(): Promise<void>;
  quit(): void;
  on(event: ApplicationLifecycleEvent, listener: () => void): () => void;
  completeQuit(): void;
}

export interface EdenPlatform {
  application: ApplicationLifecyclePort;
  windows: WindowingPort;
  rendererIpc: RendererIpcPort;
  utilityProcesses: UtilityProcessPort;
  appChannels: AppChannelPort;
  display: DisplayPort;
  processMetrics: ProcessMetricsPort;
  shortcuts: ShortcutPort;
  theme: ThemeStatePort;
  resources: ResourceProtocolPort;
}
