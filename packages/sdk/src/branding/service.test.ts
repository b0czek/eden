import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { EdenConfig } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { log } from "../logging";
import { createFilesystemBrandingAssets } from "./assets";
import { createBranding, resolveBrandingName } from "./service";

describe("branding", () => {
  let appPath: string;

  beforeEach(() => {
    appPath = fs.mkdtempSync(path.join(os.tmpdir(), "eden-branding-"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(appPath, { recursive: true, force: true });
  });

  const createService = (config: EdenConfig = {}) =>
    Effect.runPromise(
      createBranding({
        branding: config.branding,
        assets: createFilesystemBrandingAssets(appPath),
      }),
    );

  it("preserves the default Eden identity", async () => {
    const branding = await createService();

    expect(branding.getInfo()).toEqual({ name: "Eden" });
    expect(branding.getWindowTitle()).toBe("Eden");
    expect(branding.getWindowIconPath()).toBeUndefined();
  });

  it("loads a renderer-safe logo and window icon when acquisition executes", async () => {
    const acquisition = createBranding({
      branding: {
        name: "  Acme Workspace  ",
        logoPath: "assets/logo.svg",
        iconPath: "assets/icon.png",
      },
      assets: createFilesystemBrandingAssets(appPath),
    });
    fs.mkdirSync(path.join(appPath, "assets"));
    fs.writeFileSync(path.join(appPath, "assets", "logo.svg"), "<svg />");
    fs.writeFileSync(path.join(appPath, "assets", "icon.png"), "png");
    const branding = await Effect.runPromise(acquisition);

    expect(branding.getInfo()).toEqual({
      name: "Acme Workspace",
      logoDataUrl: `data:image/svg+xml;base64,${Buffer.from("<svg />").toString(
        "base64",
      )}`,
    });
    expect(branding.getWindowIconPath()).toBe(
      path.join(appPath, "assets", "icon.png"),
    );
    expect(branding.getWindowTitle()).toBe("Acme Workspace");
    expect(branding.getWindowTitle("Dedicated Console")).toBe(
      "Dedicated Console",
    );
  });

  it("allows absolute asset paths", async () => {
    const logoPath = path.join(appPath, "logo.webp");
    fs.writeFileSync(logoPath, "webp");

    const branding = await createService({
      branding: {
        name: "Acme",
        logoPath,
      },
    });

    expect(branding.getInfo().logoDataUrl).toBe(
      `data:image/webp;base64,${Buffer.from("webp").toString("base64")}`,
    );
  });

  it("warns and omits missing or unsupported assets", async () => {
    const warn = jest.spyOn(log, "warn").mockImplementation(() => undefined);
    fs.writeFileSync(path.join(appPath, "icon.svg"), "<svg />");

    const branding = await createService({
      branding: {
        name: "Acme",
        logoPath: "missing.svg",
        iconPath: "icon.svg",
      },
    });

    expect(branding.getInfo()).toEqual({ name: "Acme" });
    expect(branding.getWindowIconPath()).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to access branding logo"),
      expect.objectContaining({ code: "ENOENT" }),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('window icon with unsupported extension ".svg"'),
    );
  });

  it("rejects an empty configured product name", async () => {
    expect(() => resolveBrandingName({ name: "   " })).toThrow(
      "branding.name must be a non-empty string",
    );
    await expect(createService({ branding: { name: "   " } })).rejects.toThrow(
      "branding.name must be a non-empty string",
    );
  });
});
