---
"@edenapp/scripts": patch
"@edenapp/sdk": patch
"@edenapp/types": patch
---

Seed a demo development user in `eden-build dev` so the standalone host no longer opens the login screen with no users. Adds an optional `seedPath` to `EdenConfig` (also settable via `EDEN_DEV_SEED_PATH` in the dev host) to override the location of the seed config JSON file.
