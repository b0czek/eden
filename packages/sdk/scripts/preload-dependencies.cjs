/** Enforce the dependency boundary on the complete emitted preload graph. */
module.exports = {
  name: "preload-dependencies",
  setup(build) {
    build.initialOptions.metafile = true;
    build.onEnd(({ metafile }) => {
      if (!metafile) return;
      const dependencies = [
        ...Object.keys(metafile.inputs),
        ...Object.values(metafile.outputs).flatMap(({ imports }) =>
          imports.map(({ path }) => path),
        ),
      ];
      const forbidden = dependencies.find(
        (dependency) =>
          /^effect(?:\/|$)/.test(dependency) ||
          /(?:^|[/\\])node_modules[/\\]effect(?:[/\\]|$)/.test(dependency),
      );
      if (forbidden) {
        return {
          errors: [
            {
              text: `Effect is forbidden in app-runtime preloads: ${forbidden}`,
            },
          ],
        };
      }
    });
  },
};
