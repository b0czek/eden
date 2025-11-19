#!/usr/bin/env node

import { Command } from "commander";
import * as path from "path";
import chalk from "chalk";
import { GenesisBundler } from "./bundler";

const program = new Command();

program
  .name("genesis")
  .description("📦 Genesis - Package Eden applications into .edenite format")
  .version("0.1.0");

// Build command
program
  .command("build")
  .description("Bundle an Eden app into .edenite format")
  .argument("<app-directory>", "Path to the app directory")
  .option("-o, --output <path>", "Output path for .edenite file")
  .option("-v, --verbose", "Verbose output", false)
  .action(async (appDirectory: string, options: any) => {
    console.log(chalk.bold.blue("\n🌱 Genesis - Creating life...\n"));

    const result = await GenesisBundler.bundle({
      appDirectory: path.resolve(appDirectory),
      outputPath: options.output ? path.resolve(options.output) : undefined,
      verbose: options.verbose,
    });

    if (result.success) {
      console.log(chalk.green("\n✨ Success! App bundled successfully"));
      console.log(
        chalk.gray(`   ${result.manifest?.name} v${result.manifest?.version}`)
      );
      console.log(chalk.gray(`   → ${result.outputPath}\n`));
      process.exit(0);
    } else {
      console.log(chalk.red("\n❌ Bundle failed"));
      console.log(chalk.gray(`   ${result.error}\n`));
      process.exit(1);
    }
  });

// Validate command
program
  .command("validate")
  .description("Validate an app manifest")
  .argument("<app-directory>", "Path to the app directory")
  .action(async (appDirectory: string) => {
    console.log(chalk.bold.blue("\n🔍 Validating manifest...\n"));

    const manifestPath = path.resolve(appDirectory, "manifest.json");
    const result = await GenesisBundler.validateManifest(manifestPath);

    if (result.valid && result.manifest) {
      console.log(chalk.green("✓ Manifest is valid\n"));
      console.log(chalk.bold("App Information:"));
      console.log(chalk.gray(`  ID:          ${result.manifest.id}`));
      console.log(chalk.gray(`  Name:        ${result.manifest.name}`));
      console.log(chalk.gray(`  Version:     ${result.manifest.version}`));
      console.log(
        chalk.gray(`  Description: ${result.manifest.description || "N/A"}`)
      );
      console.log(
        chalk.gray(`  Author:      ${result.manifest.author || "N/A"}`)
      );
      console.log(
        chalk.gray(`  Backend:     ${result.manifest.backend?.entry || "N/A"}`)
      );
      console.log(
        chalk.gray(`  Frontend:    ${result.manifest.frontend.entry}\n`)
      );

      // Verify files
      const fileCheck = await GenesisBundler.verifyFiles(
        path.resolve(appDirectory),
        result.manifest
      );
      if (fileCheck.valid) {
        console.log(chalk.green("✓ All required files present\n"));
        process.exit(0);
      } else {
        console.log(chalk.yellow("⚠ Warning: Missing files"));
        fileCheck.errors.forEach((error) =>
          console.log(chalk.gray(`  - ${error}`))
        );
        console.log();
        process.exit(1);
      }
    } else {
      console.log(chalk.red("❌ Manifest is invalid\n"));
      result.errors.forEach((error) => console.log(chalk.gray(`  - ${error}`)));
      console.log();
      process.exit(1);
    }
  });

// Info command
program
  .command("info")
  .description("Display information about an .edenite file")
  .argument("<edenite-file>", "Path to the .edenite file")
  .action(async (edeniteFile: string) => {
    console.log(chalk.bold.blue("\n📄 Reading .edenite file...\n"));

    const result = await GenesisBundler.getInfo(path.resolve(edeniteFile));

    if (result.success && result.manifest) {
      console.log(chalk.bold("App Information:"));
      console.log(chalk.gray(`  ID:          ${result.manifest.id}`));
      console.log(chalk.gray(`  Name:        ${result.manifest.name}`));
      console.log(chalk.gray(`  Version:     ${result.manifest.version}`));
      console.log(
        chalk.gray(`  Description: ${result.manifest.description || "N/A"}`)
      );
      console.log(
        chalk.gray(`  Author:      ${result.manifest.author || "N/A"}`)
      );
      console.log(
        chalk.gray(`  Backend:     ${result.manifest.backend?.entry || "N/A"}`)
      );
      console.log(
        chalk.gray(`  Frontend:    ${result.manifest.frontend.entry}\n`)
      );
      process.exit(0);
    } else {
      console.log(chalk.red("❌ Failed to read .edenite file"));
      console.log(chalk.gray(`   ${result.error}\n`));
      process.exit(1);
    }
  });

program.parse();
