import "reflect-metadata";

import { FilesystemHandler } from "./FilesystemHandler";

describe("FilesystemHandler", () => {
  it("resolves a masked Eden path to a real OS path", async () => {
    const fsManager = {
      resolvePath: jest
        .fn()
        .mockReturnValue("/home/user/.config/eden-user/Documents/report.txt"),
    };

    const handler = new FilesystemHandler(
      fsManager as unknown as ConstructorParameters<
        typeof FilesystemHandler
      >[0],
    );

    await expect(
      handler.handleResolve({ path: "/Documents/report.txt" }),
    ).resolves.toEqual({
      realPath: "/home/user/.config/eden-user/Documents/report.txt",
    });
    expect(fsManager.resolvePath).toHaveBeenCalledWith("/Documents/report.txt");
  });

  it("marks resolve with the dedicated fs/resolve permission", () => {
    expect(
      Reflect.getMetadata(
        "eden:handler:permission",
        FilesystemHandler.prototype,
        "handleResolve",
      ),
    ).toBe("resolve");
  });
});
