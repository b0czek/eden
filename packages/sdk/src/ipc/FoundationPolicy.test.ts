import {
  assertFoundationCommandAllowed,
  assertFoundationEventAllowed,
} from "./FoundationPolicy";

describe("FoundationPolicy", () => {
  it.each([
    "appearance/get-wallpaper",
    "event/subscribe",
    "event/unsubscribe",
    "view/get-interface-scale",
    "view/global-mouseup",
    "view/update-global-bounds",
  ])("allows the foundation command %s", (command) => {
    expect(() => assertFoundationCommandAllowed(command)).not.toThrow();
  });

  it("rejects commands outside the foundation capability list", () => {
    expect(() => assertFoundationCommandAllowed("process/launch")).toThrow(
      "Foundation is not allowed to execute process/launch",
    );
  });

  it.each(["appearance/wallpaper-changed", "view/interface-scale-changed"])(
    "allows the foundation event %s",
    (eventName) => {
      expect(() => assertFoundationEventAllowed(eventName)).not.toThrow();
    },
  );

  it("rejects events outside the foundation capability list", () => {
    expect(() => assertFoundationEventAllowed("fs/changed")).toThrow(
      "Foundation is not allowed to subscribe to fs/changed",
    );
  });
});
