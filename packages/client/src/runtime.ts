import type { EdenAPI } from "@edenapp/types";

/** Resolve at call time so importing the client does not require an Eden runtime. */
export function getEdenAPI(): EdenAPI {
  const runtime = globalThis as typeof globalThis & {
    window?: { edenAPI?: EdenAPI };
    worker?: { edenAPI?: EdenAPI };
  };
  const api = runtime.window?.edenAPI ?? runtime.worker?.edenAPI;
  if (!api) {
    throw new Error(
      "@edenapp/client requires an Eden frontend or backend runtime",
    );
  }
  return api;
}
