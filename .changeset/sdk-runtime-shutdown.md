---
"@edenapp/sdk": patch
---

Shut down Eden runtimes cleanly by aborting in-progress startup, draining queued autostarts, cancelling hot-reload watcher setup, and preventing disposed runtimes from restarting.
