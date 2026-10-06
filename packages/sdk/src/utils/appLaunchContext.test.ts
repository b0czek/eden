import { decodeLaunchContext, encodeLaunchContext } from "./appLaunchContext";

describe("app launch context", () => {
  it("preserves arguments and volume addresses across the startup boundary", () => {
    const context = {
      appId: "com.example.handler",
      args: ["a=b", '--eden-launch={"appId":"other"}', "", "日本語"],
      file: { volume: "usb", path: '/folder with spaces/a="日本語".txt' },
    };
    expect(
      decodeLaunchContext([
        "electron",
        "preload.js",
        ...encodeLaunchContext(context),
      ]),
    ).toEqual(context);
  });

  it("supports launches without a file", () => {
    expect(
      decodeLaunchContext(
        encodeLaunchContext({ appId: "com.example.app", args: [] }),
      ),
    ).toEqual({ appId: "com.example.app", args: [], file: undefined });
  });

  it("rejects a missing context", () => {
    expect(() => decodeLaunchContext([])).toThrow("Missing app launch context");
  });

  it.each([
    "{",
    "null",
    "{}",
    '{"appId":"","args":[]}',
    '{"appId":"app","args":[1]}',
    '{"appId":"app","args":[],"file":null}',
    '{"appId":"app","args":[],"file":{"volume":"","path":"/"}}',
    '{"appId":"app","args":[],"file":{"volume":"usb","path":1}}',
  ])("rejects malformed startup data: %s", (json) => {
    expect(() => decodeLaunchContext([`--eden-launch=${json}`])).toThrow();
  });
});
