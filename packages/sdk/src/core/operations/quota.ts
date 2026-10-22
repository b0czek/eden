import { OperationCapacityExhausted } from "./errors";

export const operationQuotaLimits = Object.freeze({
  reservedPerApp: 32,
  perAppLimit: 128,
  sharedLimit: 256,
});
const { reservedPerApp, perAppLimit, sharedLimit } = operationQuotaLimits;
export function createOperationQuota() {
  const usage = new Map<string | undefined, number>();
  let sharedUsage = 0;

  function reserve(appId: string | undefined): void {
    const count = usage.get(appId) ?? 0;
    if (count >= perAppLimit)
      throw new OperationCapacityExhausted({ appId, capacity: "caller" });
    if (count >= reservedPerApp) {
      if (sharedUsage >= sharedLimit)
        throw new OperationCapacityExhausted({ appId, capacity: "shared" });
      sharedUsage++;
    }
    usage.set(appId, count + 1);
  }
  function release(appId: string | undefined): void {
    const count = usage.get(appId);
    if (count === undefined)
      throw new Error("Operation capacity reservation not found");
    // Remaining records automatically occupy the app's reserved slots first.
    if (count > reservedPerApp) sharedUsage--;
    if (count === 1) usage.delete(appId);
    else usage.set(appId, count - 1);
  }
  function clear(): void {
    usage.clear();
    sharedUsage = 0;
  }
  return { reserve, release, clear };
}
export type OperationQuota = ReturnType<typeof createOperationQuota>;
