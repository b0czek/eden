# Contributor testing

Eden separates fast algorithm tests from runtime and real-Electron integration
coverage. Use the narrowest command that covers your change while developing,
then run `pnpm test` before handing it off.

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
`packages/sdk/electron-integration/test-results/`.

CI runs lint, type checking, unit tests, and Node integration tests as
independent jobs. Electron integration runs for pull requests and pushes to
`main`; its failure artifacts are retained briefly.

## Repository administration

After merging the workflow, a repository administrator must update the
protected target branch and require the `Node integration` and
`Electron integration` checks. `Unit tests`, `Lint`, and `Typecheck` should also
remain required. Branch-protection settings live in GitHub and cannot be
applied by this repository change.
