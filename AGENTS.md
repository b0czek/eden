# General

Eden is an electron environment that strives to provide os-like experience for the user. This means it allows the user to run applications in a sandboxed environment, with access to the file system, network, and other system resources.

For every completed task that affects publishable packages, add or update an appropriate Changesets entry.

# Testing

Do not emulate integration tests with heavily mocked unit tests. Tests that mostly verify mock wiring, delegated calls, or an implementation's current call order are not a substitute for exercising real behavior across component boundaries. If meaningful integration coverage is impractical, prefer documenting the verification gap and using focused manual validation over adding low-value mock-heavy tests.

# Apps

Eden apps are sandboxed electron applications that run in WebContentsView. They communicate with main process through shell commands, and other apps through appbus.
When building an app you should strive to minimize the custom css - use [edencss](packages/sdk/edencss/README.md), which is an automatically injected styling system that provides a consistent look and feel across all apps.

# Architecture

Main-process code must not hardcode app IDs or assume a specific app implements a system capability. Resolve configured providers through `AppAssociationManager`, using declared capability permissions such as `file-picker/display` to discover defaults when no valid association exists.

Managers must use the existing internal subscription mechanism (`EdenEmitter.on(...)`) for lifecycle notifications. Never introduce a one-off listener registration method, callback array, or `onBefore...` API for a single event emission. Add a typed manager event and subscribe to it instead. If an operation requires awaited, transactional coordination rather than a notification, model that as an explicit manager operation rather than disguising it as an event listener.

# Docs

Documentation must describe supported workflows and useful behavior. Do not document rejected alternatives, removed symbols, internal implementation details, or unsupported actions unless required for migration, compatibility, or safety.

- [App Development](docs/app-development.md)
- [IPC](docs/ipc-architecture.md)
- [Adding Settings](docs/settings.md)
- [Processes and Daemons](docs/processes-and-daemons.md)
- [Localizing Apps](docs/localizing-apps.md)
