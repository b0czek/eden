import { EventEmitter } from "node:events";
import type {
  AppChannelPort,
  ApplicationLifecycleEvent,
  ApplicationLifecyclePort,
  Bounds,
  EdenPlatform,
  PlatformListener,
  PlatformMessagePort,
  PlatformUtilityProcess,
  PlatformView,
  PlatformViewOptions,
  PlatformWebContents,
  PlatformWindow,
  PlatformWindowOptions,
  RendererIpcEvent,
  RendererIpcPort,
  ShortcutPort,
  ThemeStatePort,
  UtilityProcessPort,
  WindowingPort,
} from "../platform/ports";

type RecordedEffect =
  | { type: "window-created"; options: PlatformWindowOptions }
  | { type: "view-created"; options: PlatformViewOptions }
  | { type: "file-loaded"; webContentsId: number; filePath: string }
  | { type: "url-loaded"; webContentsId: number; url: string }
  | {
      type: "message-sent";
      webContentsId: number;
      channel: string;
      args: unknown[];
    }
  | { type: "utility-process-started"; pid: number; modulePath: string }
  | { type: "utility-process-stopped"; pid: number }
  | { type: "quit" };

export interface InMemoryPlatformOptions {
  failWindowCreation?: Error;
}

class InMemoryMessagePort implements PlatformMessagePort {
  public closed = false;

  close(): void {
    this.closed = true;
  }
}

class InMemoryWebContents extends EventEmitter implements PlatformWebContents {
  public readonly session = {
    webRequest: {
      onHeadersReceived: () => undefined,
    },
  };
  private destroyed = false;
  private zoomFactor = 1;
  private devToolsOpened = false;

  constructor(
    public readonly id: number,
    private readonly effects: RecordedEffect[],
    private readonly onDestroy: () => void,
  ) {
    super();
  }

  override on<TListener extends PlatformListener>(
    event: string,
    listener: TListener,
  ): this {
    return super.on(event, listener as unknown as (...args: unknown[]) => void);
  }

  override once<TListener extends PlatformListener>(
    event: string,
    listener: TListener,
  ): this {
    return super.once(
      event,
      listener as unknown as (...args: unknown[]) => void,
    );
  }

  override removeListener<TListener extends PlatformListener>(
    event: string,
    listener: TListener,
  ): this {
    return super.removeListener(
      event,
      listener as unknown as (...args: unknown[]) => void,
    );
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  close(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.removeAllListeners();
    this.onDestroy();
  }

  focus(): void {}

  send(channel: string, ...args: unknown[]): void {
    this.effects.push({
      type: "message-sent",
      webContentsId: this.id,
      channel,
      args,
    });
  }

  postMessage(channel: string): void {
    this.send(channel);
  }

  async loadURL(url: string): Promise<void> {
    this.effects.push({ type: "url-loaded", webContentsId: this.id, url });
    queueMicrotask(() => this.emit("did-finish-load"));
  }

  async loadFile(filePath: string): Promise<void> {
    this.effects.push({
      type: "file-loaded",
      webContentsId: this.id,
      filePath,
    });
    queueMicrotask(() => this.emit("did-finish-load"));
  }

  async insertCSS(): Promise<string> {
    return "in-memory-css";
  }

  async executeJavaScript<T = unknown>(): Promise<T> {
    return undefined as T;
  }

  getZoomFactor(): number {
    return this.zoomFactor;
  }

  setZoomFactor(factor: number): void {
    this.zoomFactor = factor;
  }

  getOSProcessId(): number {
    return 10_000 + this.id;
  }

  isDevToolsOpened(): boolean {
    return this.devToolsOpened;
  }

  openDevTools(): void {
    this.devToolsOpened = true;
  }

  closeDevTools(): void {
    this.devToolsOpened = false;
  }

  setWindowOpenHandler(): void {}
}

class InMemoryView implements PlatformView {
  private bounds: Bounds = { x: 0, y: 0, width: 0, height: 0 };

  constructor(public readonly webContents: PlatformWebContents) {}

  setBounds(bounds: Bounds): void {
    this.bounds = { ...bounds };
  }

  getBounds(): Bounds {
    return { ...this.bounds };
  }
}

class InMemoryWindow extends EventEmitter implements PlatformWindow {
  private bounds: Bounds;
  private destroyed = false;
  private visible = false;
  private readonly children = new Set<PlatformView>();
  public readonly contentView = {
    addChildView: (view: PlatformView) => this.children.add(view),
    removeChildView: (view: PlatformView) => this.children.delete(view),
  };

  constructor(
    public readonly webContents: PlatformWebContents,
    options: PlatformWindowOptions,
  ) {
    super();
    this.bounds = {
      x: options.x ?? 0,
      y: options.y ?? 0,
      width: options.width ?? 800,
      height: options.height ?? 600,
    };
    this.visible = options.show ?? true;
  }

  override on<TListener extends PlatformListener>(
    event: string,
    listener: TListener,
  ): this {
    return super.on(event, listener as unknown as (...args: unknown[]) => void);
  }

  override once<TListener extends PlatformListener>(
    event: string,
    listener: TListener,
  ): this {
    return super.once(
      event,
      listener as unknown as (...args: unknown[]) => void,
    );
  }

  override removeListener<TListener extends PlatformListener>(
    event: string,
    listener: TListener,
  ): this {
    return super.removeListener(
      event,
      listener as unknown as (...args: unknown[]) => void,
    );
  }

  async loadFile(filePath: string): Promise<void> {
    await this.webContents.loadFile(filePath);
    queueMicrotask(() => this.emit("ready-to-show"));
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.webContents.close();
    this.emit("closed");
    this.removeAllListeners();
  }

  close(): void {
    this.destroy();
  }

  show(): void {
    this.visible = true;
  }

  showInactive(): void {
    this.show();
  }

  hide(): void {
    this.visible = false;
  }

  focus(): void {}

  isVisible(): boolean {
    return this.visible;
  }

  getBounds(): Bounds {
    return { ...this.bounds };
  }

  getContentBounds(): Bounds {
    return this.getBounds();
  }

  setBounds(bounds: Bounds): void {
    this.bounds = { ...bounds };
  }

  setMovable(): void {}
  setAlwaysOnTop(): void {}
  setVisibleOnAllWorkspaces(): void {}
}

class InMemoryWindowing implements WindowingPort {
  private nextId = 1;
  private readonly contents = new Map<number, InMemoryWebContents>();
  public readonly windows: InMemoryWindow[] = [];
  public readonly views: InMemoryView[] = [];

  constructor(
    private readonly effects: RecordedEffect[],
    private readonly options: InMemoryPlatformOptions,
  ) {}

  createWindow(options: PlatformWindowOptions): PlatformWindow {
    if (this.options.failWindowCreation) {
      throw this.options.failWindowCreation;
    }
    const contents = this.createWebContents();
    const window = new InMemoryWindow(contents, options);
    this.windows.push(window);
    this.effects.push({ type: "window-created", options: { ...options } });
    return window;
  }

  createView(options: PlatformViewOptions): PlatformView {
    const view = new InMemoryView(this.createWebContents());
    this.views.push(view);
    this.effects.push({ type: "view-created", options: { ...options } });
    return view;
  }

  attachWebContentsLogger(): void {}

  getWebContentsById(id: number): PlatformWebContents | undefined {
    return this.contents.get(id);
  }

  get activeWebContentsCount(): number {
    return this.contents.size;
  }

  private createWebContents(): InMemoryWebContents {
    const id = this.nextId++;
    const contents = new InMemoryWebContents(id, this.effects, () => {
      this.contents.delete(id);
    });
    this.contents.set(id, contents);
    return contents;
  }
}

type IpcHandler = (
  event: RendererIpcEvent,
  ...args: unknown[]
) => unknown | Promise<unknown>;

class InMemoryRendererIpc implements RendererIpcPort {
  private readonly handlers = new Map<string, IpcHandler>();
  private readonly listeners = new Map<string, Set<IpcHandler>>();

  handle<TArgs extends unknown[], TResult>(
    channel: string,
    handler: (
      event: RendererIpcEvent,
      ...args: TArgs
    ) => TResult | Promise<TResult>,
  ): void {
    this.handlers.set(channel, handler as IpcHandler);
  }

  on<TArgs extends unknown[]>(
    channel: string,
    listener: (event: RendererIpcEvent, ...args: TArgs) => void,
  ): void {
    const listeners = this.listeners.get(channel) ?? new Set<IpcHandler>();
    listeners.add(listener as IpcHandler);
    this.listeners.set(channel, listeners);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  removeAllListeners(channel: string): void {
    this.listeners.delete(channel);
  }

  async invoke(
    channel: string,
    senderId: number,
    ...args: unknown[]
  ): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`No IPC handler registered for ${channel}`);
    return await handler({ sender: { id: senderId } }, ...args);
  }

  get registrationCount(): number {
    return (
      this.handlers.size +
      Array.from(this.listeners.values()).reduce(
        (count, listeners) => count + listeners.size,
        0,
      )
    );
  }
}

class InMemoryUtilityProcess
  extends EventEmitter
  implements PlatformUtilityProcess
{
  public readonly stdout = null;
  public readonly stderr = null;
  private active = true;

  constructor(
    public readonly pid: number,
    private readonly onKill: () => void,
  ) {
    super();
  }

  override on<TListener extends PlatformListener>(
    event: string,
    listener: TListener,
  ): this {
    return super.on(event, listener as unknown as (...args: unknown[]) => void);
  }

  override once<TListener extends PlatformListener>(
    event: string,
    listener: TListener,
  ): this {
    return super.once(
      event,
      listener as unknown as (...args: unknown[]) => void,
    );
  }

  override removeListener<TListener extends PlatformListener>(
    event: string,
    listener: TListener,
  ): this {
    return super.removeListener(
      event,
      listener as unknown as (...args: unknown[]) => void,
    );
  }

  postMessage(): void {}

  kill(): boolean {
    if (!this.active) return false;
    this.active = false;
    this.onKill();
    this.emit("exit", 0);
    this.removeAllListeners();
    return true;
  }
}

class InMemoryUtilityProcesses implements UtilityProcessPort {
  private nextPid = 20_000;
  private readonly processes = new Map<number, InMemoryUtilityProcess>();

  constructor(private readonly effects: RecordedEffect[]) {}

  fork(modulePath: string): PlatformUtilityProcess {
    const pid = this.nextPid++;
    const process = new InMemoryUtilityProcess(pid, () => {
      this.processes.delete(pid);
      this.effects.push({ type: "utility-process-stopped", pid });
    });
    this.processes.set(pid, process);
    this.effects.push({ type: "utility-process-started", pid, modulePath });
    return process;
  }

  createMessageChannel(): {
    port1: PlatformMessagePort;
    port2: PlatformMessagePort;
  } {
    return {
      port1: new InMemoryMessagePort(),
      port2: new InMemoryMessagePort(),
    };
  }

  get activeCount(): number {
    return this.processes.size;
  }
}

class InMemoryApplication implements ApplicationLifecyclePort {
  private readonly listeners = new Map<string, Set<() => unknown>>();

  constructor(
    private readonly effects: RecordedEffect[],
    private readonly userData: string,
    private readonly appPath: string,
  ) {}

  appendCommandLineSwitch(): void {}
  getPath(): string {
    return this.userData;
  }
  getAppPath(): string {
    return this.appPath;
  }
  async whenReady(): Promise<void> {}
  quit(): void {
    this.effects.push({ type: "quit" });
  }

  on(event: ApplicationLifecycleEvent, listener: () => void): () => void {
    return this.add(event, listener);
  }
  completeQuit(): void {
    this.effects.push({ type: "quit" });
  }

  get listenerCount(): number {
    return Array.from(this.listeners.values()).reduce(
      (count, listeners) => count + listeners.size,
      0,
    );
  }

  private add(event: string, listener: () => unknown): () => void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(event);
    };
  }
}

class InMemoryShortcuts implements ShortcutPort {
  private readonly callbacks = new Map<string, () => void>();
  register(accelerator: string, callback: () => void): boolean {
    this.callbacks.set(accelerator, callback);
    return true;
  }
  unregister(accelerator: string): void {
    this.callbacks.delete(accelerator);
  }
  unregisterAll(): void {
    this.callbacks.clear();
  }
  get count(): number {
    return this.callbacks.size;
  }
}

class InMemoryTheme implements ThemeStatePort {
  public colorScheme: "light" | "dark" | "system" = "system";
  private readonly listeners = new Set<() => void>();
  onChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  get listenerCount(): number {
    return this.listeners.size;
  }
}

export class InMemoryPlatform implements EdenPlatform {
  public readonly effects: RecordedEffect[] = [];
  public readonly application: InMemoryApplication;
  public readonly windows: InMemoryWindowing;
  public readonly rendererIpc = new InMemoryRendererIpc();
  public readonly utilityProcesses: InMemoryUtilityProcesses;
  public readonly appChannels: AppChannelPort;
  public readonly display = {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayMatching: () => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
  };
  public readonly processMetrics = { getAppMetrics: () => [] };
  public readonly shortcuts = new InMemoryShortcuts();
  public readonly theme = new InMemoryTheme();

  constructor(root: string, options: InMemoryPlatformOptions = {}) {
    this.application = new InMemoryApplication(this.effects, root, root);
    this.windows = new InMemoryWindowing(this.effects, options);
    this.utilityProcesses = new InMemoryUtilityProcesses(this.effects);
    this.appChannels = {
      createMessageChannel: () => this.utilityProcesses.createMessageChannel(),
      getWebContentsById: (id) => this.windows.getWebContentsById(id),
    };
  }

  get activeResourceCount(): number {
    return (
      this.application.listenerCount +
      this.rendererIpc.registrationCount +
      this.windows.activeWebContentsCount +
      this.utilityProcesses.activeCount +
      this.shortcuts.count +
      this.theme.listenerCount
    );
  }
}
