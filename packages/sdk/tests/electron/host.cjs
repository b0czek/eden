const path = require("node:path");
const Effect = require("effect/Effect");
const v = require("valibot");
const { createEdenHost } = require("../../dist/host.js");
const {
  createElectronPlatform,
} = require("../../dist/platform/electron/index.js");
const { createEdenRuntime } = require("../../dist/runtime/runtime.js");
const {
  defineController,
  operation,
} = require("../../dist/controllers/controller.js");

const platform = createElectronPlatform();
platform.resources.registerSchemes(["eden-dlc"]);
platform.application.appendCommandLineSwitch("enable-features", "V8CodeCache");
const config = {
  appsDirectory: process.env.EDEN_TEST_APPS_DIRECTORY,
  userDirectory: process.env.EDEN_TEST_USER_DIRECTORY,
  seedPath: process.env.EDEN_TEST_SEED_PATH,
  loginAppId: "",
  window: { title: "Eden Electron Integration" },
};
const runtime = createEdenRuntime({
  config,
  platform,
  paths: {
    appsDirectory: config.appsDirectory,
    userDirectory: config.userDirectory,
    distPath: path.join(process.cwd(), "dist"),
    appPath: platform.application.getAppPath(),
  },
});
const eden = createEdenHost({ runtime, application: platform.application });
const operationReleases = new Map();

globalThis.__edenIntegration = {
  releaseOperation: (name) => operationReleases.get(name)?.(),
  eden,
  runtime,
  execute: async (command, args) => {
    const { commands, sessionContext, operations } = runtime.services;
    const caller = { sessionId: sessionContext.getSessionId() };
    const result = await commands.execute(command, args, caller);
    return commands.getMode(command) === "operation"
      ? runtime.effects.run(operations.wait(result, caller))
      : result;
  },
};

eden.whenReady().then(
  () => console.log("EDEN_INTEGRATION_READY"),
  (error) => {
    console.error("EDEN_INTEGRATION_FAILED", error);
    process.exitCode = 1;
  },
);

// A fixture operation performs real I/O after a long phase, exercising both
// transports independently of subsystem-specific elapsed time.
runtime.services.commands.registerController(
  defineController("integration", {
    commands: {
      delayed: operation({
        permission: "operation",
        input: v.object({ name: v.picklist(["renderer", "backend"]) }),
        prepare:
          ({ name }) =>
          (reporter) =>
            Effect.gen(function* () {
              const released = new Promise((resolve) =>
                operationReleases.set(name, resolve),
              );
              reporter.update("waiting-for-fixture");
              yield* Effect.sleep("31 seconds");
              yield* Effect.promise(() => released);
              operationReleases.delete(name);
              reporter.update("writing-fixture");
              yield* runtime.services.filesystem.writeFile(
                { volume: "home", path: `/operation-${name}.txt` },
                name,
              );
              return { name };
            }),
      }),
    },
  }),
);
