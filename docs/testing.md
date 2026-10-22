# Contributor testing

[Handbook](README.md) · Audience: SDK and built-in app contributors

Start with the narrowest check that covers the changed behavior.
Review warnings as well as failures.
Fix warnings within the task's scope and report any that remain.

## Test ownership

| Behavior | Location |
| --- | --- |
| Unit tests | Beside the owning module |
| SDK service integration | `packages/sdk/tests/integration` |
| SDK Electron contracts with fixture apps | `packages/sdk/tests/electron` |
| App workflows | The app's `tests/` directory |
| Workflows across built-in apps | `packages/sdk/apps/tests` |

Give each behavior one owning suite.
Use production code across the boundaries under test.
App UI assertions belong with the app, including when they use the shared Electron host.
When integration coverage is impractical, document the gap and validate manually.
Mock wiring tests do not verify integration behavior.

## Test dependencies

| Scope | Stack |
| --- | --- |
| App or library logic | Vitest, Node environment |
| Isolated Solid components | Vitest, Solid Testing Library, jsdom |
| Existing SDK and Genesis Node suites | Jest, ts-jest, @types/jest |
| App and SDK Electron workflows | Shared Playwright runner owned by the SDK |

Use `catalog:` versions for package test dependencies.
Playwright keeps its SDK version; apps use the shared runner.
Solid DOM tests need `vite-plugin-solid` and browser resolution conditions.
Exclude `**/*.electron.spec.ts` from Vitest alongside `configDefaults.exclude`.

## Run checks

Run these commands from the repository root:

```bash
pnpm --filter com.eden.files test  # one app's logic and components
pnpm test                        # unit and Node integration suites
pnpm test:unit                   # unit suites and SDK type contracts
pnpm test:integration:node
pnpm test:integration:electron    # builds required assets first
pnpm lint
pnpm typecheck
pnpm check:effects
```

For Electron, append a suite filename or use `--project=sdk` / `--project=apps`.
On headless Linux, prefix the command with `xvfb-run --auto-servernum`.

Node integration tests use `createTestEden`.
Its `executeFromView` helper returns an operation handle for operation commands.
Pass `{ waitForCompletion: true }` as the fourth argument to receive completion instead.
Place submission metadata under `submission` in that options object.
Result commands return their value in either mode.

## Test Electron workflows

Use the [shared host](../packages/sdk/tests/electron/support/host.ts):

```ts
const getHost = useElectronHost({ apps: ["com.eden.files"] });
// Inside a test:
const page = await getHost().launchApp("com.eden.files");
```

Each suite gets a temporary profile and real services.
Request only the apps and optional SDK fixtures the suite needs.
Keep app-specific data in the app suite and clean up scenario state between tests.
For a race, use [pauseCommand](../packages/sdk/tests/electron/support/commands.ts)
to delay a real request, and release it in `finally`.

Failures retain traces, screenshots, and logs in `packages/sdk/tests/electron/test-results/`.
CI runs lint, typechecking, unit, Node integration, and Electron integration separately.

## Check Effect boundaries

Select the workspace TypeScript version in your editor for Effect diagnostics.
Plain `tsc` does not load language-service plugins.
`pnpm check:effects` runs Eden's boundary checker and the official diagnostics CLI.
It covers the main-process SDK project.

Unmet requirements, unsafe Effect assertions, floating Effects, nested execution,
native timers, and Promise-returning `Effect.sync` calls are errors.
Broad error channels and ambient clocks, logging, randomness, and fetch calls are editor warnings.
Include warnings in a terminal audit with:

```bash
pnpm --filter @edenapp/sdk exec effect-language-service diagnostics --project tsconfig.json --format text --severity error,warning
```

Ordinary service methods must have their requirements provided.
Layer acquisition can require dependencies and a scope.
Generic combinators can preserve the caller's requirements.
Raw `Effect.run*`, new `ManagedRuntime` instances, and `forkDetach` need an explicit execution or ownership boundary.
Scoped forks and FiberSets remain supported.

For a justified Eden checker exception, place the directive immediately before the reported line:

```ts
// @eden-effect-next-line unresolved-requirements -- Resource acquisition belongs to the caller-owned scope.
acquire: () => acquireResource(),
```

Name one rule and explain the ownership or adapter reason.
Malformed and unused exceptions fail the check.
For official diagnostics, use `@effect-diagnostics-next-line` with an adjacent explanation.
See the [official diagnostics CLI](https://github.com/Effect-TS/language-service#effect-language-service-cli)
for its supported options.

## Control time in service tests

Use `TestClock.layer()` with the scoped
[createEffectRuntime fixture](../packages/sdk/tests/support/effect-runtime.ts)
for deadlines, retention, debounce, and retry tests.
The layer supplies both the clock and its tracking scheduler.

Advance with `TestClock.adjust(Duration.millis(...))`.
Check the instant before a deadline and the deadline itself.
Await a Deferred milestone, fiber completion, or service drain for asynchronous work.
Advancing time does not complete native I/O.

See the [backend deadline tests](../packages/sdk/tests/integration/processes/backends.test.ts)
and [operation retention tests](../packages/sdk/src/operations/retention.test.ts).
Native filesystem notifications can use real external synchronization.

## Measure EdenAPI throughput

After building the SDK, run:

```bash
pnpm --filter @edenapp/sdk benchmark:edenapi
```

Use `xvfb-run -a` on headless Linux.
The benchmark uses a temporary Electron profile and an empty synchronous command.
It measures the context bridge, IPC, caller resolution, validation, and response handling.
Each concurrency level warms up before five one-second samples.
JSON output includes samples and median requests per second.

Compare repeated runs on the same machine without concurrent builds or tests.
The measurement describes the empty endpoint, not filesystem or other domain I/O.
Pass `--async` to include an immediately resolving Effect Promise.
