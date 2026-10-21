import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { testApp } from "../../tests/support/apps";
import {
  buildService,
  createEffectRuntime,
} from "../../tests/support/effect-runtime";
import { AppAssociations } from "../app-associations/service";
import { FilesystemIoFailed } from "../filesystem/native-errors";
import { I18n } from "../i18n/service";
import { PackageCatalog } from "../packages/catalog";
import { ProcessLaunchRejected } from "../processes/errors";
import { Views } from "../views/service";

import { FileOpenFilesystem, FileOpenProcesses } from "./ports";
import { FileOpen, FileOpenLive } from "./service";

/** Fail immediately if a test starts using an unconfigured collaborator method. */
function collaborator<S extends object>(methods: Partial<S>): S {
  return new Proxy(methods, {
    get(target, property, receiver) {
      if (!Reflect.has(target, property))
        throw new Error(
          `Unconfigured collaborator member: ${String(property)}`,
        );
      return Reflect.get(target, property, receiver);
    },
  }) as S;
}

const location = { volume: "home", path: "/document.txt" };
const editor = testApp("test.editor", {
  fileHandlers: [{ name: "Text", extensions: ["txt"] }],
});

describe("file opening failures", () => {
  let effects: ReturnType<typeof createEffectRuntime>;
  let filesystem: FileOpenFilesystem;
  let processes: FileOpenProcesses;

  beforeEach(() => {
    effects = createEffectRuntime();
    filesystem = {
      inspect: () => Effect.succeed({ isDirectory: false }),
      isDirectory: () => Effect.succeed(false),
    };
    processes = { isRunning: () => false, launch: () => Effect.void };
  });
  afterEach(() => effects.dispose());

  const acquire = (apps = [editor]) =>
    effects.acquire(
      buildService(FileOpen, FileOpenLive).pipe(
        Effect.provideService(AppAssociations, {
          get: () => undefined,
          list: () => ({}),
          set: () => Effect.void,
          remove: () => Effect.void,
          initialize: () => Effect.void,
          resolve: () => [],
        }),
        Effect.provideService(
          PackageCatalog,
          collaborator<PackageCatalog>({
            listApps: () => apps,
            getApp: (id: string) => apps.find((app) => app.id === id),
            dlcsForHost: () => [],
          }),
        ),
        Effect.provideService(FileOpenProcesses, processes),
        Effect.provideService(
          Views,
          collaborator<Views>({
            getViewsByAppId: () => [],
            showView: () => Effect.void,
            focusView: () => Effect.void,
          }),
        ),
        Effect.provideService(FileOpenFilesystem, filesystem),
        Effect.provideService(
          I18n,
          collaborator<I18n>({
            getLocale: () => Effect.succeed("en"),
          }),
        ),
      ),
    );

  it("fails when no handler or explicitly selected app is installed", async () => {
    const service = await acquire([]);
    await expect(effects.run(service.openFile(location))).rejects.toMatchObject(
      {
        _tag: "FileHandlerUnavailable",
        message: "No handler found for extension .txt",
      },
    );
    await expect(
      effects.run(service.openFileWith(location, editor.id)),
    ).rejects.toMatchObject({
      _tag: "FileHandlerUnavailable",
      message: "App test.editor is not installed",
    });
  });

  it("keeps metadata and launch failures in the expected failure channel", async () => {
    const native = new Error("Cannot read file");
    const metadata = new FilesystemIoFailed({
      path: "/file.txt",
      operation: "stat",
      cause: native,
      message: native.message,
    });
    const launch = new ProcessLaunchRejected({
      appId: editor.id,
      reason: "shutting-down",
      message: "Backend not ready",
    });
    filesystem.inspect = () => Effect.fail(metadata);
    processes.launch = () => Effect.fail(launch);
    const service = await acquire();
    await expect(effects.run(service.openFile(location))).rejects.toBe(
      metadata,
    );
    await expect(
      effects.run(service.openFileWith(location, editor.id)),
    ).rejects.toBe(launch);
  });

  it.each(["openFile", "openFileWith"] as const)(
    "preserves defects in %s",
    async (method) => {
      const defect = new Error("Programmer defect");
      processes.launch = () => Effect.die(defect);
      const service = await acquire();
      const exit = await effects.run(
        Effect.exit(service[method](location, editor.id)),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(true);
        expect(Cause.hasFails(exit.cause)).toBe(false);
        expect(Cause.squash(exit.cause)).toBe(defect);
      }
    },
  );
});
