#!/usr/bin/env node
/**
 * Eden Build CLI
 *
 * Build tools for Eden projects
 */

import { Command } from "commander";
import { buildApps, buildSdkApps } from "./build-apps";
import { copyAssets } from "./copy-assets";
import { devWatch } from "./dev-watch";
import {
  type ScaffoldSolidAppMode,
  scaffoldSolidApp,
} from "./scaffold-solid-app";

const program = new Command();

program
  .name("eden-build")
  .description("Build tools for Eden projects")
  .version("0.1.0");

program
  .command("apps")
  .description("Build all configured Eden apps")
  .option("-f, --force", "Force rebuild all apps")
  .option("-c, --config <path>", "Path to eden.config.json", "eden.config.json")
  .option(
    "--sdk-path <path>",
    "Path to @edenapp/sdk (auto-detected if installed)",
  )
  .action(async (options) => {
    try {
      await buildApps({
        force: options.force || false,
        configPath: options.config,
        sdkPath: options.sdkPath,
      });
    } catch (error) {
      console.error("Build failed:", error);
      process.exit(1);
    }
  });

program
  .command("build-sdk")
  .description("Build all apps in a directory for SDK packaging")
  .requiredOption("-i, --input <path>", "Source apps directory")
  .requiredOption("-o, --output <path>", "Output directory for prebuilt apps")
  .option("-f, --force", "Force rebuild all apps")
  .action(async (options) => {
    try {
      await buildSdkApps({
        appsDir: options.input,
        outputDir: options.output,
        force: options.force || false,
      });
    } catch (error) {
      console.error("Build failed:", error);
      process.exit(1);
    }
  });

program
  .command("copy-assets")
  .description("Copy SDK runtime assets to consumer dist")
  .option(
    "--sdk-path <path>",
    "Path to @edenapp/sdk (auto-detected if installed)",
  )
  .option("-c, --config <path>", "Path to eden.config.json", "eden.config.json")
  .option("-o, --output <path>", "Output directory", "dist")
  .action(async (options) => {
    try {
      await copyAssets({
        sdkPath: options.sdkPath,
        outputDir: options.output,
        configPath: options.config,
      });
    } catch (error) {
      console.error("Copy failed:", error);
      process.exit(1);
    }
  });

program
  .command("scaffold-solid")
  .description("Scaffold a minimal renderer-only Solid Eden app")
  .argument("<app-id>", "App ID (for example: com.eden.my-app)")
  .argument(
    "[output-dir]",
    "Directory to create the app in (defaults depend on scaffold mode)",
  )
  .option("-n, --name <name>", "Display name for the app")
  .option("-m, --mode <mode>", "Scaffold mode: auto, sdk, consumer", "auto")
  .option("-f, --force", "Allow writing into a non-empty target directory")
  .action(async (appId, outputDir, options) => {
    try {
      await scaffoldSolidApp({
        appId,
        outputDir,
        name: options.name,
        mode: options.mode as ScaffoldSolidAppMode,
        force: options.force || false,
      });
    } catch (error) {
      console.error("Scaffold failed:", error);
      process.exit(1);
    }
  });

program
  .command("watch")
  .description("Start hot-reload development server for apps")
  .option("-c, --config <path>", "Path to eden.config.json", "eden.config.json")
  .option(
    "--sdk-path <path>",
    "Path to @edenapp/sdk (auto-detected if installed)",
  )
  .action(async (options) => {
    try {
      await devWatch(options.config, options.sdkPath);
    } catch (error) {
      console.error("Watch failed:", error);
      process.exit(1);
    }
  });

program.parse();
