import * as v from "valibot";
import { filesystemSourceSchema } from "./location-schema";

describe("filesystem source validation", () => {
  it("accepts locations and handles and strips unrelated location metadata", () => {
    expect(
      v.parse(filesystemSourceSchema, {
        volume: "home",
        path: "/file.txt",
        extra: true,
      }),
    ).toEqual({ volume: "home", path: "/file.txt" });
    expect(v.parse(filesystemSourceSchema, { handleId: "opened" })).toEqual({
      handleId: "opened",
    });
  });

  it.each([
    { handleId: "opened", volume: "home", path: "/file.txt" },
    { handleId: "opened", volume: "home" },
    { handleId: "opened", path: "/file.txt" },
    { handleId: undefined, volume: "home", path: "/file.txt" },
  ])("rejects ambiguous handle/location input %j", (source) => {
    expect(v.safeParse(filesystemSourceSchema, source).success).toBe(false);
  });

  it.each([
    "/file.txt",
    {},
    { location: { volume: "home", path: "/file.txt" } },
  ])("rejects invalid sources %j", (source) => {
    expect(v.safeParse(filesystemSourceSchema, source).success).toBe(false);
  });
});
