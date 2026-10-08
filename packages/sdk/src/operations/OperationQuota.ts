/** Reserved app and host capacity with a shared pool for bursts. */
export class OperationQuota {
  static readonly reservedPerApp = 32;
  static readonly perAppLimit = 128;
  static readonly sharedLimit = 256;

  // App identity spans sessions; callers without an app share the host allowance.
  private readonly usage = new Map<string | undefined, number>();
  private sharedUsage = 0;

  reserve(appId: string | undefined): void {
    const count = this.usage.get(appId) ?? 0;
    if (count >= OperationQuota.perAppLimit)
      throw new Error(
        "Operation capacity exhausted for this caller; retry after records expire",
      );
    if (count >= OperationQuota.reservedPerApp) {
      if (this.sharedUsage >= OperationQuota.sharedLimit)
        throw new Error(
          "Shared operation capacity exhausted; retry after records expire",
        );
      this.sharedUsage++;
    }
    this.usage.set(appId, count + 1);
  }

  release(appId: string | undefined): void {
    const count = this.usage.get(appId);
    if (count === undefined)
      throw new Error("Operation capacity reservation not found");
    // Remaining records automatically occupy the app's reserved slots first.
    if (count > OperationQuota.reservedPerApp) this.sharedUsage--;
    if (count === 1) this.usage.delete(appId);
    else this.usage.set(appId, count - 1);
  }

  clear(): void {
    this.usage.clear();
    this.sharedUsage = 0;
  }
}
