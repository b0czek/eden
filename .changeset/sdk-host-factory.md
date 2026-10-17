---
"@edenapp/sdk": minor
---

Create Electron hosts with `createEden(config)`. Asynchronous host APIs return lazy Effects that compose before execution through `eden.runPromise` or `eden.runFork`; `dispose()` explicitly shuts down the host. Sandboxed apps keep the Promise-based Eden client.
