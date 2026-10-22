# General

Eden is an electron environment that strives to provide os-like experience for the user. This means it allows the user to run applications in a sandboxed environment, with access to the file system, network, and other system resources.

Changesets describe user-facing release units, not individual tasks or commits. Before adding one, inspect the unreleased entries and recent branch history for an existing changeset covering the same feature or fix. Add a new changeset only for a separately releasable user-facing change to a publishable package; do not add one for internal-only work that does not change the package's released behavior. Give new changesets a descriptive `<package>-<release-unit>.md` filename, such as `sdk-runtime-shutdown.md`, so related work can find and reuse them.

A changeset summary is a concise release note, not a work log or an inventory of edits. Fixing bugs in an unreleased feature is part of delivering that feature: do not add separate changesets, bug-fix bullets, or extra sentences for those corrections. Do not list tests, refactors, implementation details, review changes, or minor UI adjustments. Describe a bug fix as a release change only when it corrects behavior users have already received in a released version. Rewrite an existing entry only when the final user-facing scope materially changes; summarize the resulting feature as a whole instead of appending every follow-up change.

# Testing

Review warnings as well as errors from verification. Resolve both within the
task's scope; do not treat a successful exit status as a clean result when
warnings remain. Report any unresolved warnings and why they remain, and do
not weaken checks merely to silence them.

When adding or relocating tests, follow the dependency sets and test boundaries
in [Contributor testing](docs/testing.md#test-dependencies).

Do not emulate integration tests with heavily mocked unit tests. Tests that mostly verify mock wiring, delegated calls, or an implementation's current call order are not a substitute for exercising real behavior across component boundaries. If meaningful integration coverage is impractical, prefer documenting the verification gap and using focused manual validation over adding low-value mock-heavy tests.

# Apps

Eden apps are sandboxed electron applications that run in WebContentsView. They communicate with main process through shell commands, and other apps through appbus.
When building an app you should strive to minimize the custom css - use [edencss](packages/sdk/edencss/README.md), which is an automatically injected styling system that provides a consistent look and feel across all apps.

# Architecture

Main-process code must not hardcode app IDs or assume a specific app implements a system capability. Resolve configured providers through the app-associations service, using declared capability permissions such as `file-picker/display` to discover defaults when no valid association exists.

Services must use the shared event primitives (`createEvent(...)`,
`scopedEvent(...)`, `listen(...)`, and each source's `.on(...)`) for lifecycle
notifications. Scoped factories own event cleanup through their Effect scope;
synchronous owners release their sources during disposal. Never introduce a one-off listener registration method, callback array, or `onBefore...` API for a single event emission. Add a typed domain event and subscribe to it instead. If an operation requires awaited, transactional coordination rather than a notification, model that as an explicit service operation rather than disguising it as an event listener.

Read [Controllers and domain events](docs/controllers.md) before adding or converting
domain services, plain controller definitions, or their domain event sources.

# Docs

Aim for approximately 75% adherence to ASD-STE100 in documentation. Use it as a style guide, while keeping Eden's technical terms where needed.

Documentation must describe supported workflows and useful behavior. Do not document rejected alternatives, removed symbols, internal implementation details, or unsupported actions unless required for migration, compatibility, or safety.

- [App Development](docs/app-development.md)
- [IPC](docs/ipc-architecture.md)
- [Adding Settings](docs/settings.md)
- [Processes and Daemons](docs/processes-and-daemons.md)
- [Localizing Apps](docs/localizing-apps.md)
