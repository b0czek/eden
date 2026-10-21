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

Node integration tests use `createTestEden`. Its `executeFromView` method runs
commands through renderer IPC and returns an operation handle by default. Pass
`{ waitForCompletion: true }` as its fourth argument to await an operation and
return its completion value or reject with its failure. Result commands return
their values in either mode. Put submission metadata in the same options object
under `submission`.

## Eden API throughput

After building the SDK, run `pnpm --filter @edenapp/sdk benchmark:edenapi`.
On headless Linux, prefix the command with `xvfb-run -a`.

The benchmark uses a temporary Electron profile and a renderer app calling
`edenAPI.shellCommand` against an empty, synchronous controller command. It
includes the context bridge, Electron IPC, caller resolution, command validation,
and response handling. Each concurrency level (1, 8, 32, 128) warms up before five
one-second samples; JSON output includes every sample and median requests per
second. Compare repeated runs on the same machine without concurrent builds or
tests. These measurements describe the empty endpoint, not domain I/O capacity.
Pass `--async` to benchmark an immediately resolving Effect Promise instead,
exercising pending response handling without native I/O.

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

Eden's boundary check inspects exported `Context.Service` contracts and the
methods and Effect-valued properties returned by standalone `create...` factories,
including nested capabilities defined in the same module and Promise-wrapped
results. Imported services are checked at their own keys or factories. Layer
acquisition may require dependencies and a scope; ordinary service methods must
have their requirements provided. A capability that intentionally acquires a
resource in its caller's scope documents that ownership beside the method with
a narrow exception. Generic combinators may preserve the caller's requirement
parameter.
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

## Effect-owned time

Use `TestClock.layer()` with the scoped
[`createEffectRuntime`](../packages/sdk/tests/support/effect-runtime.ts) fixture
for service deadlines, retention, debounce and retry tests. The layer installs
both the clock and its tracking scheduler; providing only a clock does not offer
the same ordering guarantees for forked sleeps.

Advance time with `TestClock.adjust(Duration.millis(...))`. Check the instant
before a deadline as well as the deadline itself. Await explicit milestones with
`Deferred`, fiber completion, or the service's drain method; advancing time does
not complete native I/O. See the
[backend deadline tests](../packages/sdk/tests/integration/processes/Backends.test.ts)
and [operation retention tests](../packages/sdk/src/operations/retention.test.ts).

Operation timestamps and expiry read the Clock captured during acquisition, so
synchronous admission and completion finalizers share the service's clock.
Accepted operations still drain before runtime disposal. Native filesystem
notification tests can retain real external synchronization, and unrelated Jest
suites can keep their existing timer setup.

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
