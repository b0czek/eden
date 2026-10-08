const { OperationManager } = require("../dist/operations/OperationManager.js");
const { SessionContext } = require("../dist/session/SessionContext.js");
const { Eden } = require("../dist/index.js");

const eden = new Eden({
  appsDirectory: process.env.EDEN_TEST_APPS_DIRECTORY,
  userDirectory: process.env.EDEN_TEST_USER_DIRECTORY,
  seedPath: process.env.EDEN_TEST_SEED_PATH,
  loginAppId: "",
  window: {
    title: "Eden Electron Integration",
  },
});

globalThis.__edenIntegration = {
  eden,
  execute: async (command, args) => {
    const registry = eden.runtime.ipcBridge.commandRegistry;
    const caller = {
      sessionId: eden.runtime.resolve(SessionContext).getSessionId(),
    };
    const result = await registry.execute(command, args, caller);
    return registry.getMode(command) === "operation"
      ? eden.runtime.resolve(OperationManager).wait(result, caller)
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

// A fixture command performs real I/O after a long task phase, exercising both
// transports independently of subsystem-specific elapsed time.
const {
  EdenHandler,
  EdenNamespace,
} = require("../dist/ipc/CommandDecorators.js");
const {
  FilesystemManager,
} = require("../dist/filesystem/FilesystemManager.js");
class IntegrationOperations {
  prepare(args) {
    if (
      typeof args.name !== "string" ||
      !["renderer", "backend"].includes(args.name)
    )
      throw new Error("Invalid integration operation name");
    return {
      run: async (reporter) => {
        reporter.update("waiting-for-fixture");
        await new Promise((resolve) => setTimeout(resolve, 31_000));
        reporter.update("writing-fixture");
        await eden.runtime
          .resolve(FilesystemManager)
          .writeFile(
            { volume: "home", path: `/operation-${args.name}.txt` },
            args.name,
          );
        return { name: args.name };
      },
    };
  }
}
EdenNamespace("integration")(IntegrationOperations);
EdenHandler("delayed", { mode: "operation", permission: "operation" })(
  IntegrationOperations.prototype,
  "prepare",
  Object.getOwnPropertyDescriptor(IntegrationOperations.prototype, "prepare"),
);
eden.runtime.ipcBridge.commandRegistry.registerManager(
  new IntegrationOperations(),
);
