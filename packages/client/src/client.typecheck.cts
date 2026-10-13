import { fs, package as packages } from "@edenapp/client";
import type { FileStats } from "@edenapp/types";

function commonJsSignatures() {
  const stat: Promise<FileStats> = fs.stat({
    volume: "home",
    path: "/notes.txt",
  });
  packages.list();
  // @ts-expect-error required arguments remain required for CommonJS imports
  fs.stat();
  return stat;
}
void commonJsSignatures;
