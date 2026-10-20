import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { command } from "../../src/controllers/controller";
import type { Filesystem } from "../../src/filesystem/service";
import type { Volumes } from "../../src/filesystem/volumes";
import type { PackageTransactions } from "../../src/packages/transactions";

class CallerResource extends Context.Service<
  CallerResource,
  { value: number }
>()("test/CallerResource") {}

declare const filesystem: Filesystem;
declare const volumes: Volumes;
declare const transactions: PackageTransactions;
const work = Effect.map(CallerResource, ({ value }) => value);

// Each wrapper preserves the caller's dependency for later composition.
const volumeWork = volumes.withVolumes([], work);
const fileWork = filesystem.withVolume(
  { volume: "Home", path: "/" },
  () => work,
);
const packageWork = transactions.runExclusive(work);
Effect.provideService(volumeWork, CallerResource, { value: 42 });
Effect.provideService(fileWork, CallerResource, { value: 42 });
Effect.provideService(packageWork, CallerResource, { value: 42 });

// @ts-expect-error Volume ownership does not provide the caller's resource.
command({ handle: () => volumeWork });
// @ts-expect-error Path resolution does not provide the caller's resource.
command({ handle: () => fileWork });
// @ts-expect-error The package lock does not provide the caller's resource.
command({ handle: () => packageWork });
