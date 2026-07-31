import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type Listener = (...args: unknown[]) => unknown;

interface EdenHarness {
  Eden: typeof import("./Eden").Eden;
  app: {
    quit: jest.Mock;
  };
  appListeners: Map<string, Listener>;
  completeElectronReady: () => void;
  instances: Record<string, Record<string, jest.Mock>>;
  order: string[];
  windows: Array<{
    options: Record<string, unknown>;
    loadFile: jest.Mock;
    show: jest.Mock;
    webContents: {
      id: number;
      on: jest.Mock;
      once: jest.Mock;
    };
    emit: (event: string) => void;
    emitWebContents: (event: string) => void;
  }>;
}

function managerClass(name: string): new () => object {
  return { [name]: class {} }[name] as new () => object;
}

async function loadEdenHarness(): Promise<EdenHarness> {
  jest.resetModules();

  const order: string[] = [];
  const appListeners = new Map<string, Listener>();
  const windows: EdenHarness["windows"] = [];
  let completeElectronReady!: () => void;
  const electronReady = new Promise<void>((resolve) => {
    completeElectronReady = resolve;
  });

  const app = {
    commandLine: { appendSwitch: jest.fn() },
    getPath: jest.fn(() => path.join(os.tmpdir(), "eden-characterization")),
    getAppPath: jest.fn(() => "/consumer"),
    whenReady: jest.fn(() => electronReady),
    on: jest.fn((event: string, listener: Listener) => {
      appListeners.set(event, listener);
    }),
    quit: jest.fn(),
  };

  class BrowserWindow {
    readonly options: Record<string, unknown>;
    readonly loadFile = jest.fn();
    readonly show = jest.fn();
    readonly webContentsListeners = new Map<string, Listener>();
    readonly windowListeners = new Map<string, Listener>();
    readonly webContents = {
      id: windows.length + 1,
      on: jest.fn((event: string, listener: Listener) => {
        this.webContentsListeners.set(event, listener);
      }),
      once: jest.fn((event: string, listener: Listener) => {
        this.webContentsListeners.set(event, listener);
      }),
    };

    constructor(options: Record<string, unknown>) {
      this.options = options;
      order.push("window");
      windows.push({
        options,
        loadFile: this.loadFile,
        show: this.show,
        webContents: this.webContents,
        emit: (event) => this.windowListeners.get(event)?.(),
        emitWebContents: (event) => this.webContentsListeners.get(event)?.(),
      });
    }

    once(event: string, listener: Listener): void {
      this.windowListeners.set(event, listener);
    }

    on(event: string, listener: Listener): void {
      this.windowListeners.set(event, listener);
    }
  }

  jest.doMock("electron", () => ({ app, BrowserWindow }));

  const instances: EdenHarness["instances"] = {
    BrandingManager: {
      getWindowTitle: jest.fn((title?: string) => title ?? "Eden"),
      getWindowIconPath: jest.fn(() => "/consumer/icon.png"),
    },
    CommandRegistry: { registerManager: jest.fn() },
    BackendManager: {},
    IPCBridge: {
      setMainWindow: jest.fn(),
      destroy: jest.fn(() => order.push("ipc.destroy")),
    },
    SettingsPanelManager: {
      synchronizeManifestPanels: jest.fn(() => order.push("panels.sync")),
      connectLifecycle: jest.fn(),
    },
    AppearanceManager: {
      initialize: jest.fn(async () => order.push("appearance.initialize")),
    },
    ViewManager: { setMainWindow: jest.fn() },
    AppChannelManager: {},
    FilesystemManager: {},
    UserManager: {
      initialize: jest.fn(async () => order.push("user.initialize")),
    },
    SettingsManager: {},
    I18nManager: {},
    PackageManager: {
      initialize: jest.fn(async () => order.push("package.initialize")),
    },
    ProcessManager: {
      shutdown: jest.fn(async () => order.push("process.shutdown")),
    },
    SessionManager: {
      initialize: jest.fn(async () => order.push("session.initialize")),
    },
    DaemonManager: {
      initialize: jest.fn(async () => order.push("daemon.initialize")),
      shutdown: jest.fn(async () => order.push("daemon.shutdown")),
    },
    ExecutionContext: {},
    GrantCatalogManager: {},
    AppAssociationManager: {
      initialize: jest.fn(async () => order.push("associations.initialize")),
    },
    FileOpenManager: {
      initialize: jest.fn(async () => order.push("file-open.initialize")),
    },
    AutostartManager: {
      onFoundationReady: jest.fn(() => order.push("autostart.foundation")),
    },
    KeyboardManager: {
      setMainWindow: jest.fn(),
      destroy: jest.fn(() => order.push("keyboard.destroy")),
    },
    SystemHandler: {},
    PowerHandler: {},
    NotificationManager: {},
    ContextMenuManager: {},
    FilePickerManager: {},
    DbManager: {},
    AppCatalog: {},
  };

  const classes = Object.fromEntries(
    Object.keys(instances).map((name) => [name, managerClass(name)]),
  );
  const container = {
    registerInstance: jest.fn(),
    resolve: jest.fn((token: { name: string }) => instances[token.name]),
  };

  jest.doMock("tsyringe", () => ({ container }));
  jest.doMock("./api/createControlPlaneApi", () => ({
    createControlPlaneApis: jest.fn(() => ({
      apps: {},
      daemons: {},
      users: {},
      sessions: {},
      appearance: {},
      associations: {},
    })),
  }));
  jest.doMock("./api/createSettingsApi", () => ({
    createSettingsApi: jest.fn(() => ({})),
  }));
  jest.doMock("./app-associations", () => ({
    AppAssociationManager: classes.AppAssociationManager,
  }));
  jest.doMock("./app-registry", () => ({ AppCatalog: classes.AppCatalog }));
  jest.doMock("./appbus", () => ({
    AppChannelManager: classes.AppChannelManager,
  }));
  jest.doMock("./appearance/AppearanceManager", () => ({
    AppearanceManager: classes.AppearanceManager,
  }));
  jest.doMock("./branding", () => ({
    BrandingManager: classes.BrandingManager,
  }));
  jest.doMock("./context-menu", () => ({
    ContextMenuManager: classes.ContextMenuManager,
  }));
  jest.doMock("./daemon", () => ({ DaemonManager: classes.DaemonManager }));
  jest.doMock("./db", () => ({ DbManager: classes.DbManager }));
  jest.doMock("./execution/ExecutionContext", () => ({
    ExecutionContext: classes.ExecutionContext,
  }));
  jest.doMock("./file-open", () => ({
    FileOpenManager: classes.FileOpenManager,
  }));
  jest.doMock("./file-picker", () => ({
    FilePickerManager: classes.FilePickerManager,
  }));
  jest.doMock("./filesystem", () => ({
    FilesystemManager: classes.FilesystemManager,
  }));
  jest.doMock("./i18n/I18nManager", () => ({
    I18nManager: classes.I18nManager,
  }));
  jest.doMock("./ipc", () => ({
    CommandRegistry: classes.CommandRegistry,
    IPCBridge: classes.IPCBridge,
  }));
  jest.doMock("./keyboard/KeyboardManager", () => ({
    KeyboardManager: classes.KeyboardManager,
  }));
  jest.doMock("./logging", () => ({
    log: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));
  jest.doMock("./logging/electron", () => ({
    attachWebContentsLogger: jest.fn(),
  }));
  jest.doMock("./notification", () => ({
    NotificationManager: classes.NotificationManager,
  }));
  jest.doMock("./package-manager", () => ({
    PackageManager: classes.PackageManager,
  }));
  jest.doMock("./power", () => ({ PowerHandler: classes.PowerHandler }));
  jest.doMock("./process-manager", () => ({
    AutostartManager: classes.AutostartManager,
    BackendManager: classes.BackendManager,
    ProcessManager: classes.ProcessManager,
  }));
  jest.doMock("./seed", () => ({
    seedDatabase: jest.fn(async () => order.push("seed")),
  }));
  jest.doMock("./session", () => ({ SessionManager: classes.SessionManager }));
  jest.doMock("./settings", () => ({
    SettingsManager: classes.SettingsManager,
    SettingsPanelManager: classes.SettingsPanelManager,
    registerBuiltinSettingsPanels: jest.fn(),
  }));
  jest.doMock("./SystemHandler", () => ({
    SystemHandler: classes.SystemHandler,
  }));
  jest.doMock("./user", () => ({
    GrantCatalogManager: classes.GrantCatalogManager,
    UserManager: classes.UserManager,
  }));
  jest.doMock("./user/UserHandler", () => ({
    UserHandler: managerClass("UserHandler"),
  }));
  jest.doMock("./view-manager", () => ({ ViewManager: classes.ViewManager }));

  const { Eden } = require("./Eden") as typeof import("./Eden");
  return {
    Eden,
    app,
    appListeners,
    completeElectronReady,
    instances,
    order,
    windows,
  };
}

describe("Eden host characterization", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "eden-characterization-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it("transitions through readiness and preserves startup and presentation contracts", async () => {
    const harness = await loadEdenHarness();
    const eden = new harness.Eden({
      appsDirectory: path.join(root, "apps"),
      userDirectory: path.join(root, "users"),
      window: {
        width: 1440,
        height: 900,
        minWidth: 640,
        minHeight: 480,
        title: "Characterized Eden",
        backgroundColor: "#123456",
      },
    });

    expect(eden.state).toBe("created");
    expect(() => eden.apps).toThrow(
      "Await eden.whenReady() before using operational APIs",
    );
    expect(harness.windows).toHaveLength(0);

    harness.completeElectronReady();
    await eden.whenReady();

    expect(eden.state).toBe("ready");
    expect(harness.order).toEqual([
      "seed",
      "user.initialize",
      "package.initialize",
      "panels.sync",
      "daemon.initialize",
      "session.initialize",
      "appearance.initialize",
      "associations.initialize",
      "file-open.initialize",
      "window",
    ]);
    expect(eden.apps).toEqual({});

    const window = harness.windows[0];
    expect(window.options).toMatchObject({
      width: 1440,
      height: 900,
      minWidth: 800,
      minHeight: 600,
      title: "Characterized Eden",
      icon: "/consumer/icon.png",
      backgroundColor: "#123456",
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        additionalArguments: ["--window-title=Characterized Eden"],
      },
    });
    expect(window.loadFile).toHaveBeenCalledWith(
      path.join(process.cwd(), "dist/foundation/foundation.html"),
    );

    window.emitWebContents("did-finish-load");
    window.emit("ready-to-show");
    expect(
      harness.instances.AutostartManager.onFoundationReady,
    ).toHaveBeenCalledTimes(1);
    expect(window.show).toHaveBeenCalledTimes(1);
  });

  it("preserves app-event and ordered shutdown behavior", async () => {
    const harness = await loadEdenHarness();
    const eden = new harness.Eden({
      appsDirectory: path.join(root, "apps"),
      userDirectory: path.join(root, "users"),
    });
    harness.completeElectronReady();
    await eden.whenReady();

    harness.appListeners.get("window-all-closed")?.();
    expect(harness.app.quit).toHaveBeenCalledTimes(1);

    const shutdown = harness.appListeners.get("before-quit")?.();
    expect(eden.state).toBe("stopping");
    await shutdown;

    expect(eden.state).toBe("stopped");
    expect(harness.order.slice(-4)).toEqual([
      "daemon.shutdown",
      "process.shutdown",
      "keyboard.destroy",
      "ipc.destroy",
    ]);
  });
});
