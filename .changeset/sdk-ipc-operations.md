---
"@edenapp/sdk": minor
"@edenapp/types": minor
---

Add typed IPC operations with prompt acceptance, retained completion and failures, scoped renderer and backend observation, request-key deduplication, and draining before session changes and runtime shutdown. Event listeners share remote subscriptions, recover safely from registration failures, isolate asynchronous callback errors, and release backend subscriptions on exit. Immediate commands keep their existing results; stream and cancellation interfaces are reserved for future support.
