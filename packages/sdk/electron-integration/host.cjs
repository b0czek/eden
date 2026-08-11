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
  execute: (command, args) =>
    eden.runtime.ipcBridge.commandRegistry.execute(command, args),
};

eden.whenReady().then(
  () => console.log("EDEN_INTEGRATION_READY"),
  (error) => {
    console.error("EDEN_INTEGRATION_FAILED", error);
    process.exitCode = 1;
  },
);
