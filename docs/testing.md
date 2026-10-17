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
pnpm check:effects                # SDK runtime Effect diagnostics
```

For Electron, append a filename to select a suite or use `--project=sdk` /
`--project=apps`. On headless Linux, prefix the command with
`xvfb-run --auto-servernum`.

## Effect diagnostics

The SDK's `tsconfig.json` configures `@effect/language-service` for editor
feedback. Select the workspace TypeScript version in your editor. CI runs
`pnpm check:effects` separately from TypeScript; plain `tsc` does not load
language-service plugins. It combines Eden's type-aware boundary check with the
[official diagnostics CLI](https://github.com/Effect-TS/language-service#effect-language-service-cli)
without patching the installed compiler. It covers the main-process SDK project;
renderer clients and app preload projects keep their own TypeScript configuration.

Unmet requirements, unsafe Effect assertions, floating Effects, nested runtime
execution, native timers, and Promise-returning `Effect.sync` calls are errors.
Broad error channels and ambient clocks, logging, randomness, and fetch calls
are editor warnings. Use the SDK command below to include those warnings in a
terminal audit:

```sh
pnpm --filter @edenapp/sdk exec effect-language-service diagnostics --project tsconfig.json --format text --severity error,warning
```

Eden's boundary check inspects the methods and Effect-valued properties returned
by exported `create...` factories, including Promise-wrapped results. Acquisition
may require a scope; ordinary service methods must have their requirements
provided. Generic combinators may preserve the caller's requirement parameter.
Raw `Effect.run*` references, new `ManagedRuntime` instances, and `forkDetach`
require explicit boundary or ownership decisions. Scoped forks and FiberSets
remain supported. These checks catch specific construction patterns; they do not
prove every asynchronous resource is owned or that accepted work drains correctly.

For Eden's checks, place an exception immediately before the reported line:

```ts
// @eden-effect-next-line unresolved-requirements -- Resource acquisition belongs to the caller-owned scope.
acquire: () => acquireResource(),
```

An exception must name one rule and explain the adapter or ownership reason.
Malformed and unused exceptions fail the check. For official Effect diagnostics,
use their `@effect-diagnostics-next-line` directive with an adjacent explanation.
Keep an exception next to the expression it governs and suppress only that
diagnostic. Native adapters and heterogeneous execution boundaries may need exceptions; domain
work should compose Effects with its dependencies provided.

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
