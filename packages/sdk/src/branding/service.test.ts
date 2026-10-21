import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { EdenConfig } from "@edenapp/types";
import * as Effect from "effect/Effect";
import {
  buildService,
  createEffectRuntime,
} from "../../tests/support/effect-runtime";
import { log } from "../logging/logger";
import { createFilesystemBrandingAssets } from "./assets";
import { InvalidBrandingName } from "./errors";
import { BrandingAssets, BrandingConfig } from "./ports";
import { Branding, BrandingLive, resolveBrandingName } from "./service";

const serviceEffects = createEffectRuntime();
afterAll(() => serviceEffects.dispose());

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
    serviceEffects.acquire(
      buildService(Branding, BrandingLive).pipe(
        Effect.provideService(BrandingConfig, config.branding),
        Effect.provideService(
          BrandingAssets,
          createFilesystemBrandingAssets(appPath),
        ),
      ),
    );

  it("preserves the default Eden identity", async () => {
    const branding = await createService();

    expect(branding.getInfo()).toEqual({ name: "Eden" });
    expect(branding.getWindowTitle()).toBe("Eden");
    expect(branding.getWindowIconPath()).toBeUndefined();
  });

  it("loads a renderer-safe logo and window icon when acquisition executes", async () => {
    const acquisition = buildService(Branding, BrandingLive).pipe(
      Effect.provideService(BrandingConfig, {
        name: "  Acme Workspace  ",
        logoPath: "assets/logo.svg",
        iconPath: "assets/icon.png",
      }),
      Effect.provideService(
        BrandingAssets,
        createFilesystemBrandingAssets(appPath),
      ),
    );
    fs.mkdirSync(path.join(appPath, "assets"));
    fs.writeFileSync(path.join(appPath, "assets", "logo.svg"), "<svg />");
    fs.writeFileSync(path.join(appPath, "assets", "icon.png"), "png");
    const branding = await serviceEffects.acquire(acquisition);

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
      InvalidBrandingName,
    );
    await expect(
      createService({ branding: { name: "   " } }),
    ).rejects.toMatchObject({
      _tag: "InvalidBrandingName",
      configuredName: "   ",
      message: "branding.name must be a non-empty string",
    });
  });

  it("omits a logo that becomes unreadable after its file check", async () => {
    const warn = jest.spyOn(log, "warn").mockImplementation(() => undefined);
    fs.writeFileSync(path.join(appPath, "logo.svg"), "<svg />");
    const failure = Object.assign(new Error("Permission denied"), {
      code: "EACCES",
    });
    jest.spyOn(fs.promises, "readFile").mockRejectedValueOnce(failure);

    const branding = await createService({
      branding: { name: "Acme", logoPath: "logo.svg" },
    });

    expect(branding.getInfo()).toEqual({ name: "Acme" });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to read branding logo"),
      expect.objectContaining({
        _tag: "FilesystemIoFailed",
        operation: "readFile",
        cause: failure,
      }),
    );
  });
});
