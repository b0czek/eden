import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { testApp } from "../../tests/support/apps";
import { createEffectRuntime } from "../../tests/support/effect-runtime";
import type { FileOpenFilesystem, FileOpenProcesses } from "./ports";
import { createFileOpen } from "./service";

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
      createFileOpen({
        associations: {
          get: () => undefined,
          list: () => ({}),
          set: () => Effect.void,
          remove: () => Effect.void,
        },
        catalog: {
          listApps: () => apps,
          getApp: (id) => apps.find((app) => app.id === id),
          dlcsForHost: () => [],
        },
        filesystem,
        processes,
        views: {
          getViewsByAppId: () => [],
          showView: () => {},
          focusView: () => {},
        },
        i18n: { getLocale: () => Effect.succeed("en") },
      }),
    );

  it("fails when no handler or explicitly selected app is installed", async () => {
    const service = await acquire([]);
    await expect(effects.run(service.openFile(location))).rejects.toMatchObject(
      {
        _tag: "FileOpenFailure",
        message: "No handler found for extension .txt",
      },
    );
    await expect(
      effects.run(service.openFileWith(location, editor.id)),
    ).rejects.toMatchObject({
      _tag: "FileOpenFailure",
      message: "App test.editor is not installed",
    });
  });

  it("keeps metadata and launch failures in the expected failure channel", async () => {
    filesystem.inspect = () => Effect.fail(new Error("Cannot read file"));
    processes.launch = () => Effect.fail(new Error("Backend not ready"));
    const service = await acquire();
    await expect(effects.run(service.openFile(location))).rejects.toMatchObject(
      {
        _tag: "FileOpenFailure",
        message: "Cannot read file",
      },
    );
    await expect(
      effects.run(service.openFileWith(location, editor.id)),
    ).rejects.toMatchObject({
      _tag: "FileOpenFailure",
      message: "Backend not ready",
    });
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
