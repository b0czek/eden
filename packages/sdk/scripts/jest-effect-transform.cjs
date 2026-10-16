const { transformSync } = require("esbuild");

// Node 24 can require Effect's ESM directly; Jest's CJS runtime needs this bridge.
module.exports = {
  process(sourceText, sourcePath) {
    return transformSync(sourceText, {
      loader: "js",
      format: "cjs",
      platform: "node",
      target: "node24",
      sourcefile: sourcePath,
      sourcemap: "inline",
    });
  },
};
