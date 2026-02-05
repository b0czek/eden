/**
 * Bundle App Frame Script
 *
 * Compiles TypeScript files from src/app-frame and bundles them into
 * a single JavaScript file using esbuild.
 */

const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");

const srcDir = path.join(__dirname, "../src/app-frame");
const distDir = path.join(__dirname, "../dist/app-frame");

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

async function bundle() {
  try {
    console.log("🔍 Type-checking TypeScript files...");

    // Run TypeScript compiler for type checking (no emit)
    const { execSync } = require("child_process");
    try {
      execSync("npx tsc --noEmit -p src/app-frame/tsconfig.json", {
        stdio: "inherit",
        cwd: path.join(__dirname, ".."),
      });
      console.log("✅ Type checking passed\n");
    } catch (error) {
      console.error("❌ Type checking failed");
      process.exit(1);
    }

    console.log("🔨 Bundling app-frame TypeScript files...");

    // Bundle frame-injector.ts (main entry point for the frame)
    await esbuild.build({
      entryPoints: [path.join(srcDir, "frame-injector.ts")],
      bundle: true,
      outfile: path.join(distDir, "frame-injector.js"),
      format: "iife", // Immediately Invoked Function Expression for browser
      target: "es2020",
      platform: "browser",
      minify: true,
      sourcemap: true,
      logLevel: "info",
    });

    console.log("✅ frame-injector.js bundled successfully");

    // Copy CSS file
    const cssSource = path.join(srcDir, "frame.css");
    const cssDest = path.join(distDir, "frame.css");

    if (fs.existsSync(cssSource)) {
      fs.copyFileSync(cssSource, cssDest);
      console.log("✅ frame.css copied successfully");
    } else {
      console.warn("⚠️  frame.css not found, skipping");
    }

    console.log("🎉 App-frame bundling complete!");
  } catch (error) {
    console.error("❌ Bundling failed:", error);
    process.exit(1);
  }
}

bundle();
