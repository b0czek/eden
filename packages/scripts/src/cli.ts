#!/usr/bin/env node
/**
 * Eden Build CLI
 *
 * Build tools for Eden projects
 */

import { Command } from "commander";
import { buildApps } from "./build-apps";
import { copyAssets } from "./copy-assets";
import { devWatch } from "./dev-watch";

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
    "Path to @edenapp/sdk (auto-detected if installed)"
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
  .command("copy-assets")
  .description("Copy SDK runtime assets to consumer dist")
  .option(
    "--sdk-path <path>",
    "Path to @edenapp/sdk (auto-detected if installed)"
  )
  .option("-o, --output <path>", "Output directory", "dist")
  .action(async (options) => {
    try {
      await copyAssets({
        sdkPath: options.sdkPath,
        outputDir: options.output,
      });
    } catch (error) {
      console.error("Copy failed:", error);
      process.exit(1);
    }
  });

program
  .command("watch")
  .description("Start hot-reload development server for apps")
  .option("-c, --config <path>", "Path to eden.config.json", "eden.config.json")
  .option(
    "--sdk-path <path>",
    "Path to @edenapp/sdk (auto-detected if installed)"
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
