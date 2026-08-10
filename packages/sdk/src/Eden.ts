import "reflect-metadata";
import * as path from "node:path";
import type { EdenConfig } from "@edenapp/types";
import type {
  EdenAppearanceApi,
  EdenAssociationsApi,
  EdenDaemonsApi,
  EdenLifecycleState,
  EdenPackagesApi,
  EdenSessionsApi,
  EdenSettingsApi,
  EdenUsersApi,
} from "./api";
import { createElectronPlatform } from "./platform/electron";
import { EdenRuntime } from "./runtime/EdenRuntime";

/** Public Electron host for one isolated Eden runtime. */
export class Eden {
  private readonly runtime: EdenRuntime;
  public readonly settings: EdenSettingsApi;

  constructor(config: EdenConfig = {}) {
    const platform = createElectronPlatform();
    // Electron requires privileged schemes to be declared before app readiness;
    // DlcResourceManager attaches the authorized file handler during startup.
    platform.resources.registerSchemes(["eden-dlc"]);
    const application = platform.application;
    application.appendCommandLineSwitch("enable-features", "V8CodeCache");

    const appsDirectory =
      config.appsDirectory ??
      path.join(application.getPath("userData"), "eden-apps");
    const userDirectory =
      config.userDirectory ??
      path.join(application.getPath("userData"), "eden-user");

    this.runtime = new EdenRuntime({
      config,
      platform,
      paths: {
        appsDirectory,
        userDirectory,
        distPath: path.join(process.cwd(), "dist"),
        appPath: application.getAppPath(),
      },
    });
    this.settings = this.runtime.settings;
    this.setupAppEventHandlers(application);
  }

  public whenReady(): Promise<void> {
    return this.runtime.whenReady();
  }

  public get state(): EdenLifecycleState {
    return this.runtime.state;
  }

  public get packages(): EdenPackagesApi {
    return this.runtime.packages;
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

  private setupAppEventHandlers(
    application: ReturnType<typeof createElectronPlatform>["application"],
  ): void {
    void application
      .whenReady()
      .then(() => this.runtime.start())
      .catch(() => undefined);
    application.on("window-all-closed", () => application.quit());
    application.on("activate", () => this.runtime.activate());
    application.on("quit-requested", () => {
      void this.runtime.dispose().finally(() => application.completeQuit());
    });
  }
}
