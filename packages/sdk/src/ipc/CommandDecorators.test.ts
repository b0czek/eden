import "reflect-metadata";

import { EdenHandler, EdenNamespace } from "./CommandDecorators";
import { getManagerMetadata } from "./CommandMetadata";

describe("CommandDecorators", () => {
  it("stores namespace, events, and handler metadata", () => {
    @EdenNamespace("process", { events: "ProcessEvents" })
    class ProcessManager {
      @EdenHandler("launch", {
        permission: "manage",
        grant: "settings/com.eden/process",
      })
      handleLaunch(): void {}
    }

    const metadata = getManagerMetadata(new ProcessManager());

    expect(metadata?.namespace).toBe("process");
    expect(metadata?.handlers.get("launch")).toBe("handleLaunch");

    expect(Reflect.getMetadata("eden:namespace", ProcessManager)).toBe(
      "process",
    );
    expect(Reflect.getMetadata("eden:events", ProcessManager)).toBe(
      "ProcessEvents",
    );
    expect(
      Reflect.getMetadata(
        "eden:handler:permission",
        ProcessManager.prototype,
        "handleLaunch",
      ),
    ).toBe("manage");
    expect(
      Reflect.getMetadata(
        "eden:handler:grant",
        ProcessManager.prototype,
        "handleLaunch",
      ),
    ).toBe("settings/com.eden/process");
  });
});
