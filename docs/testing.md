# Testing

Start with the narrowest check that covers your change.

## Test ownership

| Behavior | Location |
| --- | --- |
| Unit tests | Beside the owning module |
| SDK service integration | `packages/sdk/tests/integration` |
| SDK Electron contracts, using SDK fixture apps | `packages/sdk/tests/electron` |
| App workflows | The app's `tests/` directory |
| Workflows spanning built-in apps | `packages/sdk/apps/tests` |

App UI and app-specific assertions belong with apps, including when they use the
shared Electron host. Give each behavior one owning suite and assert observable
results through production code.

## Test dependencies

| Scope | Stack |
| --- | --- |
| App/library logic | Vitest, Node environment |
| Isolated Solid components | Vitest + Solid Testing Library + jsdom |
| Existing SDK/Genesis Node suites | Jest + ts-jest + @types/jest |
| App and SDK Electron workflows | Playwright, owned by the SDK |

Use `catalog:` versions for package test dependencies. Playwright keeps its SDK
version; apps use the shared runner. Solid DOM tests need `vite-plugin-solid`
and browser resolution conditions. Exclude `**/*.electron.spec.ts` from Vitest
alongside `configDefaults.exclude` so each runner executes its own tests.

## Commands

Run from the repository root:

```bash
pnpm --filter com.eden.files test  # one app's logic/component tests
pnpm test                        # unit and Node integration suites
pnpm test:unit                   # unit suites and SDK type contracts
pnpm test:integration:node        # Node integration only
pnpm test:integration:electron    # SDK and app workflows; builds assets first
pnpm lint
pnpm typecheck
```

For Electron, append a filename to select a suite or use `--project=sdk` /
`--project=apps`. On headless Linux, prefix the command with
`xvfb-run --auto-servernum`.

## Electron setup

Use the [shared host](../packages/sdk/tests/electron/support/host.ts):

```ts
const getHost = useElectronHost({ apps: ["com.eden.files"] });
// Inside a test:
const page = await getHost().launchApp("com.eden.files");
```

Each suite gets a temporary profile and real Eden services. Request only needed
apps and optional SDK fixtures; keep app-specific fixture data in the app suite.
Clean up scenario state between tests. For races, use
[pauseCommand](../packages/sdk/tests/electron/support/commands.ts) to delay a real
request, and dispose the pause in `finally`.

Failures retain traces, screenshots and logs under
`packages/sdk/tests/electron/test-results/`. CI runs lint, typechecking, unit,
Node integration and Electron integration as separate jobs.
