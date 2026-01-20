# General

Eden is an electron environment that strives to provide os-like experience for the user. This means it allows the user to run applications in a sandboxed environment, with access to the file system, network, and other system resources.

# Apps

Eden apps are sandboxed electron applications that run in WebContentsView. They communicate with main process through shell commands, and other apps through appbus.
When building an app you should strive to minimize the custom css - use [edencss](packages/sdk/edencss/README.md), which is an automatically injected styling system that provides a consistent look and feel across all apps.

# Docs

- [App Development](docs/app-development.md)
- [IPC](docs/ipc-architecture.md)
- [Localizing Apps](docs/localizing-apps.md)
