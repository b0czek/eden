import * as eden from "@edenapp/client";
import {
  fs,
  package as packages,
  process,
  settings,
  system,
} from "@edenapp/client";
import type { FileStats, Operation, SystemInfo } from "@edenapp/types";

function signatures() {
  const location = { volume: "home", path: "/file.txt" };
  const stat: Promise<FileStats> = fs.stat(location);
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
  return { stat, info, completion };
}
void signatures;
