import { fs, package as packages } from "@edenapp/client";
import type { FileStats } from "@edenapp/types";

function commonJsSignatures() {
  const stat: Promise<FileStats> = fs.stat({
    volume: "home",
    path: "/notes.txt",
  });
  packages.list();
  const subscribed: Promise<void> = fs.subscribe("changed", (event) => {
    const watchId: string = event.watchId;
    return watchId;
  });
  // @ts-expect-error CommonJS imports use domain-local event names too
  fs.unsubscribe("fs/changed", () => {});
  // @ts-expect-error required arguments remain required for CommonJS imports
  fs.stat();
  return { stat, subscribed };
}
void commonJsSignatures;
