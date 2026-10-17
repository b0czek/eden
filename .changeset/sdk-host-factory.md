---
"@edenapp/sdk": minor
"@edenapp/types": minor
---

Create Electron hosts with `createEden(config)`. Asynchronous host APIs return lazy Effects that compose before execution through `eden.runPromise` or `eden.runFork`; `dispose()` explicitly shuts down the host. Host settings and power providers also return Effects, with their contracts exported by the SDK. Sandboxed apps keep the Promise-based Eden client.
