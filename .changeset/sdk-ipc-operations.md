---
"@edenapp/sdk": minor
"@edenapp/types": minor
"@edenapp/solid-kit": minor
"@edenapp/files-core": patch
---

Add typed long-running IPC operations with immediate acceptance, guaranteed capacity per app, and observable progress, completion, and failures. Built-in apps display operation progress and status, and Solid apps can use `createOperation` and `OperationStatus` for their own UI. Accepted work finishes before session changes and runtime shutdown.
