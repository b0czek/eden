---
"@edenapp/sdk": patch
---

Isolate each Eden host in an independently disposable runtime and add Node and
real-Electron integration coverage for lifecycle, permissions, persistence,
views, IPC, processes, and shutdown behavior. Enforce the Electron platform
boundary through the SDK's Biome checks. Replace mock-heavy control-plane,
settings, process, filesystem, and file-association tests with runtime
integration scenarios that use real Eden services and persistence.
