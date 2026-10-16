---
"@edenapp/sdk": minor
---

Create Electron hosts with `createEden(config)` instead of `new Eden(config)`. The returned host exposes `dispose()` for explicit shutdown alongside its existing readiness and control APIs.
