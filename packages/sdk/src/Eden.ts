import "reflect-metadata";
import * as path from "node:path";
import type { EdenConfig } from "@edenapp/types";
import { app } from "electron";
import type {
  EdenAppearanceApi,
  EdenAppsApi,
  EdenAssociationsApi,
  EdenDaemonsApi,
  EdenLifecycleState,
  EdenSessionsApi,
  EdenSettingsApi,
  EdenUsersApi,
} from "./api";
import { EdenRuntime } from "./runtime/EdenRuntime";

/** Public Electron host for one isolated Eden runtime. */
export class Eden {
  private readonly runtime: EdenRuntime;
  public readonly settings: EdenSettingsApi;

  constructor(config: EdenConfig = {}) {
    app.commandLine.appendSwitch("enable-features", "V8CodeCache");

    const appsDirectory =
      config.appsDirectory ?? path.join(app.getPath("userData"), "eden-apps");
    const userDirectory =
      config.userDirectory ?? path.join(app.getPath("userData"), "eden-user");

    this.runtime = new EdenRuntime({
      config,
      paths: {
        appsDirectory,
        userDirectory,
        distPath: path.join(process.cwd(), "dist"),
        appPath: app.getAppPath(),
      },
    });
    this.settings = this.runtime.settings;
    this.setupAppEventHandlers();
  }

  public whenReady(): Promise<void> {
    return this.runtime.whenReady();
  }

  public get state(): EdenLifecycleState {
    return this.runtime.state;
  }

  public get apps(): EdenAppsApi {
    return this.runtime.apps;
  }

  public get daemons(): EdenDaemonsApi {
    return this.runtime.daemons;
  }

  public get users(): EdenUsersApi {
    return this.runtime.users;
  }

  public get sessions(): EdenSessionsApi {
    return this.runtime.sessions;
  }

  public get appearance(): EdenAppearanceApi {
    return this.runtime.appearance;
  }

  public get associations(): EdenAssociationsApi {
    return this.runtime.associations;
  }

  private setupAppEventHandlers(): void {
    void app
      .whenReady()
      .then(() => this.runtime.start())
      .catch(() => undefined);
    app.on("window-all-closed", () => app.quit());
    app.on("activate", () => this.runtime.activate());
    app.on("before-quit", () => this.runtime.dispose());
  }
}
