import "reflect-metadata";

import { PackageHandler } from "../package-manager/PackageHandler";
import { PowerHandler } from "../power/PowerHandler";
import { ProcessHandler } from "../process-manager/ProcessHandler";
import { SystemHandler } from "../SystemHandler";
import { ViewHandler } from "../view-manager/ViewHandler";
import { getManagerMetadata } from "./CommandMetadata";

type Constructor = { prototype: object };

function commandContract(
  Handler: Constructor,
): Record<string, string | undefined> {
  const instance = Object.create(Handler.prototype) as { constructor: object };
  const metadata = getManagerMetadata(instance);
  if (!metadata) throw new Error("Missing Eden command metadata");

  return Object.fromEntries(
    [...metadata.handlers].map(([command, methodName]) => [
      `${metadata.namespace}/${command}`,
      Reflect.getMetadata(
        "eden:handler:permission",
        Handler.prototype,
        methodName,
      ) as string | undefined,
    ]),
  );
}

describe("built-in command contract characterization", () => {
  it("preserves externally visible command names and permission metadata", () => {
    expect(commandContract(SystemHandler)).toEqual({
      "system/info": undefined,
      "system/branding": undefined,
    });
    expect(commandContract(PowerHandler)).toEqual({
      "system/power-capabilities": "power",
      "system/power": "power",
    });
    expect(commandContract(PackageHandler)).toMatchObject({
      "package/install": "manage",
      "package/uninstall": "manage",
      "package/list": "read",
      "package/self": undefined,
      "package/get": "read",
      "package/get-info": "read",
    });
    expect(commandContract(ProcessHandler)).toEqual({
      "process/launch": "manage",
      "process/stop": "manage",
      "process/exit": undefined,
      "process/list": "read",
      "process/metrics": "read",
    });
    expect(commandContract(ViewHandler)).toMatchObject({
      "view/update-bounds": undefined,
      "view/update-view-bounds": "manage",
      "view/set-visibility": undefined,
      "view/set-view-visibility": "manage",
      "view/update-global-bounds": "manage",
    });
  });
});
