#!/usr/bin/env node

import { Command } from "commander";
import * as path from "path";
import chalk from "chalk";
import { GenesisBundler } from "./bundler";

const program = new Command();

program
  .name("genesis")
  .description("📦 Genesis - Package Eden applications into .edenite format")
  .version("0.2.0");

// Build command
program
  .command("build")
  .description("Bundle an Eden app into .edenite format")
  .argument("<app-directory>", "Path to the app directory")
  .option("-o, --output <path>", "Output path for .edenite file")
  .option("-v, --verbose", "Verbose output", false)
  .option("-d, --dry-run", "Validate without creating files", false)
  .option("-c, --compression <level>", "Zstd compression level (1-22, default: 11)", "11")
  .action(async (appDirectory: string, options: any) => {
    console.log(chalk.bold.blue("\n🌱 Genesis - Creating life...\n"));

    const compressionLevel = parseInt(options.compression, 10);
    if (isNaN(compressionLevel) || compressionLevel < 1 || compressionLevel > 22) {
      console.log(chalk.red("\n❌ Invalid compression level"));
      console.log(chalk.gray("   Compression level must be between 1 and 22\n"));
      process.exit(1);
    }

    const result = await GenesisBundler.bundle({
      appDirectory: path.resolve(appDirectory),
      outputPath: options.output ? path.resolve(options.output) : undefined,
      verbose: options.verbose,
      dryRun: options.dryRun,
      compressionLevel,
    });

    if (result.success) {
      if (options.dryRun) {
        console.log(chalk.green("\n✨ Dry run successful - validation passed"));
        console.log(
          chalk.gray(`   ${result.manifest?.name} v${result.manifest?.version}`)
        );
        console.log(chalk.gray("   No files were created\n"));
      } else {
        console.log(chalk.green("\n✨ Success! App bundled successfully"));
        console.log(
          chalk.gray(`   ${result.manifest?.name} v${result.manifest?.version}`)
        );
        console.log(chalk.gray(`   → ${result.outputPath}`));
        if (result.checksum) {
          console.log(chalk.gray(`   SHA256: ${result.checksum}`));
        }
        console.log();
      }
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
        chalk.gray(`  Frontend:    ${result.manifest.frontend.entry}`)
      );
      if (result.checksum) {
        console.log(chalk.gray(`  SHA256:      ${result.checksum}`));
      }
      console.log();
      process.exit(0);
    } else {
      console.log(chalk.red("❌ Failed to read .edenite file"));
      console.log(chalk.gray(`   ${result.error}\n`));
      process.exit(1);
    }
  });

// Extract command
program
  .command("extract")
  .description("Extract an .edenite file to a directory")
  .argument("<edenite-file>", "Path to the .edenite file")
  .argument("<output-directory>", "Directory to extract to")
  .option("-v, --verbose", "Verbose output", false)
  .option("--no-verify", "Skip checksum verification")
  .action(async (edeniteFile: string, outputDirectory: string, options: any) => {
    console.log(chalk.bold.blue("\n📂 Extracting .edenite file...\n"));

    const result = await GenesisBundler.extract({
      edenitePath: path.resolve(edeniteFile),
      outputDirectory: path.resolve(outputDirectory),
      verbose: options.verbose,
      verifyChecksum: options.verify !== false,
    });

    if (result.success) {
      console.log(chalk.green("\n✨ Success! Archive extracted"));
      if (result.manifest) {
        console.log(
          chalk.gray(`   ${result.manifest.name} v${result.manifest.version}`)
        );
      }
      console.log(chalk.gray(`   → ${path.resolve(outputDirectory)}\n`));
      process.exit(0);
    } else {
      console.log(chalk.red("\n❌ Extraction failed"));
      console.log(chalk.gray(`   ${result.error}\n`));
      process.exit(1);
    }
  });

program.parse();
