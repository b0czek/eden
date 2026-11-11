---
"@edenapp/sdk": minor
"@edenapp/types": minor
"@edenapp/client": minor
---

Add stream commands, which send results to the calling app while their work continues. Generated client methods return a stream that apps read with `for await`, with backpressure and cancellation. Eden stops a stream when its view or backend closes, or when its view reloads.
