import * as eden from "@edenapp/client";
import {
  fs,
  package as packages,
  process,
  settings,
  system,
} from "@edenapp/client";
import type {
  EventData,
  FileStats,
  FilesystemHandle,
  FilesystemLocation,
  Operation,
  SystemInfo,
} from "@edenapp/types";

function signatures() {
  const location = { volume: "home", path: "/file.txt" };
  const scope: Promise<FilesystemLocation> = fs.accessScope("home");
  const stat: Promise<FileStats> = fs.stat(location);
  const opened: Promise<FilesystemHandle> = fs.open(location, { mode: "read" });
  const handle = { handleId: "example" };
  const handleStat: Promise<FileStats> = fs.stat(handle);
  const handleText: Promise<string> = fs.read(handle, { encoding: "utf8" });
  const handleBytes: Promise<Uint8Array> = fs.readBinary(handle);
  const closed: Promise<void> = fs.close(handle);
  const info: Promise<SystemInfo> = system.info();
  const copy: Promise<Operation<"fs/cp">> = fs.cp(location, location, {
    overwrite: true,
    submission: { requestKey: "copy" },
  });
  const completion: Promise<void> = copy.then((operation) =>
    operation.result(),
  );
  fs.write(location, "contents", { encoding: "utf8" });
  process.list();
  process.list({ showHidden: true });
  settings.get("theme");
  eden.db.getSu("app.id", "theme");
  packages.list();
  eden.package.list();
  eden.appearance.setWallpaper({ type: "preset", id: "eden-default" });
  // @ts-expect-error wallpaper settings retain their discriminated public input type
  eden.appearance.setWallpaper({ type: "invalid" });
  const changed = (event: EventData<"settings/panels-changed">) => {
    const panelId: string | undefined = event.panelId;
    return panelId;
  };
  const subscribed: Promise<void> = settings.subscribe(
    "panels-changed",
    changed,
  );
  const unsubscribed: void = settings.unsubscribe("panels-changed", changed);
  fs.subscribe("changed", (event) => {
    const watchId: string = event.watchId;
    // @ts-expect-error payloads belong to the selected event
    event.panelId;
    return watchId;
  });
  // @ts-expect-error event names are local to the domain
  settings.subscribe("settings/changed", () => {});
  // @ts-expect-error events from other domains are not accepted
  settings.subscribe("launched", () => {});
  // @ts-expect-error callbacks must accept the selected event's payload
  fs.subscribe("changed", (event: { panelId: string }) => {});
  // @ts-expect-error command-only domains do not expose subscriptions
  system.subscribe("changed", () => {});
  // @ts-expect-error a location is required
  fs.stat();
  // @ts-expect-error positional arguments unwrap the top-level args object
  fs.stat({ location });
  // @ts-expect-error content must be a string
  fs.write(location, 12);
  // @ts-expect-error options must be typed
  fs.cp(location, location, { overwrite: "yes" });
  // @ts-expect-error submission is available only for operation commands
  fs.read(location, { submission: { requestKey: "read" } });
  // @ts-expect-error caller context is not part of the client contract
  eden.db.get("theme", { _callerAppId: "other.app" });
  // @ts-expect-error empty commands take no arguments
  system.info({});
  // @ts-expect-error invalid normalized method
  fs.readbinary(location);
  return {
    stat,
    scope,
    info,
    completion,
    opened,
    handleStat,
    handleText,
    handleBytes,
    closed,
    subscribed,
    unsubscribed,
  };
}
void signatures;
