import {
  _electron as electron,
  expect,
  test,
  type TestInfo,
} from "@playwright/test";
import {
  APP_ID,
  createElectronProfile,
  disposeElectronProfile,
  type ElectronProfile,
} from "./profile";
import * as path from "node:path";

export type ElectronApplication = Awaited<ReturnType<typeof electron.launch>>;
export type ElectronPage = Awaited<
  ReturnType<ElectronApplication["firstWindow"]>
>;
export interface ElectronHost extends ElectronProfile {
  electronApp: ElectronApplication | undefined;
  foundation: ElectronPage;
  mainPid: number;
  utilityPids: number[];
  executeHostCommand<TResult>(command: string, args: unknown): Promise<TResult>;
  evaluateApp(appId: string, script: string): Promise<unknown>;
  launchFixture(): Promise<void>;
  dispose(testInfo: TestInfo): Promise<void>;
}

export async function createElectronHost(): Promise<ElectronHost> {
  const profile = await createElectronProfile();
  const { root, appsDirectory, userDirectory, seedPath } = profile;
  const logs: string[] = [];
  let electronApp: ElectronApplication | undefined;
  let foundation: ElectronPage;
  let mainPid = -1;
  try {
    const executablePath = require("electron") as string;
    electronApp = await electron.launch({
      executablePath,
      args: [path.join(__dirname, "../host.cjs")],
      cwd: root,
      env: {
        ...process.env,
        EDEN_LOG_CALLSITE: "false",
        EDEN_TEST_APPS_DIRECTORY: appsDirectory,
        EDEN_TEST_USER_DIRECTORY: userDirectory,
        EDEN_TEST_SEED_PATH: seedPath,
      },
    });
    mainPid = electronApp.process().pid ?? -1;
    electronApp.on("console", async (message) => {
      const values = await Promise.all(
        message.args().map((argument) => argument.jsonValue()),
      );
      logs.push(values.map(String).join(" "));
    });
    await expect
      .poll(async () => {
        const titles = await Promise.all(
          electronApp?.windows().map((page) => page.title()) ?? [],
        );
        return titles.includes("Eden Electron Integration");
      })
      .toBe(true);
    const windows = electronApp.windows();
    const titles = await Promise.all(windows.map((page) => page.title()));
    foundation = windows[titles.indexOf("Eden Electron Integration")];
    await expect
      .poll(() =>
        electronApp?.evaluate(() => {
          const integration = globalThis as typeof globalThis & {
            __edenIntegration?: { eden: { state: string } };
          };
          return integration.__edenIntegration?.eden.state;
        }),
      )
      .toBe("ready");
  } catch (error) {
    await electronApp?.close().catch(() => undefined);
    await disposeElectronProfile(profile);
    throw error;
  }
  const host: ElectronHost = {
    ...profile,
    electronApp,
    foundation: foundation!,
    mainPid,
    utilityPids: [],
    async executeHostCommand<TResult>(
      command: string,
      args: unknown,
    ): Promise<TResult> {
      if (!host.electronApp) throw new Error("Electron app is not running");
      return host.electronApp.evaluate(
        async (_electron, payload) => {
          const integration = globalThis as typeof globalThis & {
            __edenIntegration: {
              execute(command: string, args: unknown): Promise<unknown>;
            };
          };
          return integration.__edenIntegration.execute(
            payload.command,
            payload.args,
          );
        },
        { command, args },
      ) as Promise<TResult>;
    },
    async evaluateApp(appId: string, script: string) {
      if (!host.electronApp) throw new Error("Electron app is not running");
      return host.electronApp.evaluate(
        async ({ webContents }, input) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => candidate.getURL().includes(input.appId));
          return contents?.executeJavaScript(input.script);
        },
        { appId, script },
      );
    },
    async launchFixture() {
      await host.executeHostCommand("process/launch", { appId: APP_ID });
      await expect
        .poll(() => host.evaluateApp(APP_ID, "typeof window.edenClient"))
        .toBe("object");
    },
    async dispose(testInfo) {
      try {
        await host.electronApp?.close().catch(() => undefined);
        host.electronApp = undefined;
        await testInfo.attach("eden.log", {
          body: logs.join("\n"),
          contentType: "text/plain",
        });
        await testInfo.attach("process-diagnostics.json", {
          body: JSON.stringify(
            { mainPid: host.mainPid, utilityPids: host.utilityPids },
            null,
            2,
          ),
          contentType: "application/json",
        });
      } finally {
        await disposeElectronProfile(profile);
      }
    },
  };
  return host;
}

export function useElectronHost(options: { launchFixture?: boolean } = {}) {
  let host: ElectronHost | undefined;
  test.beforeAll(async () => {
    host = await createElectronHost();
    if (options.launchFixture !== false) await host.launchFixture();
  });
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires fixture destructuring.
  test.afterAll(async ({}, testInfo) => {
    await host?.dispose(testInfo);
  });
  return () => {
    if (!host) throw new Error("Electron host has not started");
    return host;
  };
}

export function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
