import { copyFile } from "node:fs/promises";
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.cjs",
  bundle: true,
  platform: "neutral",
  format: "cjs",
  target: "es2022",
  sourcemap: true,
});
// The generated namespace declarations are self-contained, so both module
// formats can expose the same contract without crossing declaration formats.
await copyFile("dist/commands.generated.d.ts", "dist/index.d.cts");
