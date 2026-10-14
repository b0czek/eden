# Contributor testing

Eden separates fast algorithm tests from runtime and real-Electron integration
coverage. Use the narrowest command that covers your change while developing,
then run `pnpm test` before handing it off.

Unit tests live beside their owning module under `packages/sdk/src`. Tests that
exercise collaboration across services or layers live under
`packages/sdk/tests/integration`, grouped by behavior or domain. An import alone
does not make a test an integration test; the behavior being exercised does.
Shared test helpers live under `packages/sdk/tests/support`. Real Electron
workflows live in `packages/sdk/tests/electron`.

The SDK's Jest commands select unit and Node integration suites by directory.
Production builds exclude test files and test support code.

```bash
pnpm test:unit                  # SDK unit tests and other package test suites
pnpm test:integration:node      # real Eden services with in-memory platform edges
pnpm test:integration:electron  # built host, preload IPC, views, and utility processes
pnpm test                       # unit plus Node integration coverage
pnpm lint                       # Biome checks, including the SDK Electron boundary
```

The Electron command builds the required SDK runtime assets before launching
Playwright. On headless Linux, run it through Xvfb:

```bash
xvfb-run --auto-servernum pnpm test:integration:electron
```

Electron tests use readiness signals, observable process state, and Playwright
assertions. They intentionally have no retries. When one fails, inspect the
trace, screenshot, `eden.log`, and process diagnostics under
`packages/sdk/tests/electron/test-results/`.

CI runs lint, type checking, unit tests, and Node integration tests as
independent jobs. Electron integration runs for pull requests and pushes to
`main`; its failure artifacts are retained briefly.

## Repository administration

After merging the workflow, a repository administrator must update the
protected target branch and require the `Node integration` and
`Electron integration` checks. `Unit tests`, `Lint`, and `Typecheck` should also
remain required. Branch-protection settings live in GitHub and cannot be
applied by this repository change.
