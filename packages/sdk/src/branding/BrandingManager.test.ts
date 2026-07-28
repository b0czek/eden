import "reflect-metadata";

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { EdenConfig } from "@edenapp/types";
import { log } from "../logging";
import { BrandingManager } from "./BrandingManager";

describe("BrandingManager", () => {
  let appPath: string;

  beforeEach(() => {
    appPath = fs.mkdtempSync(path.join(os.tmpdir(), "eden-branding-"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(appPath, { recursive: true, force: true });
  });

  const createManager = (config: EdenConfig = {}) =>
    new BrandingManager(config, appPath);

  it("preserves the default Eden identity", () => {
    const manager = createManager();

    expect(manager.getInfo()).toEqual({ name: "Eden" });
    expect(manager.getWindowTitle()).toBe("Eden");
    expect(manager.getWindowIconPath()).toBeUndefined();
  });

  it("loads a renderer-safe logo and resolves the window icon", () => {
    fs.mkdirSync(path.join(appPath, "assets"));
    fs.writeFileSync(path.join(appPath, "assets", "logo.svg"), "<svg />");
    fs.writeFileSync(path.join(appPath, "assets", "icon.png"), "png");

    const manager = createManager({
      branding: {
        name: "  Acme Workspace  ",
        logoPath: "assets/logo.svg",
        iconPath: "assets/icon.png",
      },
    });

    expect(manager.getInfo()).toEqual({
      name: "Acme Workspace",
      logoDataUrl: `data:image/svg+xml;base64,${Buffer.from("<svg />").toString(
        "base64",
      )}`,
    });
    expect(manager.getInfo()).not.toHaveProperty("logoPath");
    expect(manager.getInfo()).not.toHaveProperty("iconPath");
    expect(manager.getWindowIconPath()).toBe(
      path.join(appPath, "assets", "icon.png"),
    );
    expect(manager.getWindowTitle()).toBe("Acme Workspace");
    expect(manager.getWindowTitle("Dedicated Console")).toBe(
      "Dedicated Console",
    );
  });

  it("allows absolute asset paths", () => {
    const logoPath = path.join(appPath, "logo.webp");
    fs.writeFileSync(logoPath, "webp");

    const manager = createManager({
      branding: {
        name: "Acme",
        logoPath,
      },
    });

    expect(manager.getInfo().logoDataUrl).toBe(
      `data:image/webp;base64,${Buffer.from("webp").toString("base64")}`,
    );
  });

  it("warns and omits missing or unsupported assets", () => {
    const warn = jest.spyOn(log, "warn").mockImplementation(() => undefined);
    fs.writeFileSync(path.join(appPath, "icon.svg"), "<svg />");

    const manager = createManager({
      branding: {
        name: "Acme",
        logoPath: "missing.svg",
        iconPath: "icon.svg",
      },
    });

    expect(manager.getInfo()).toEqual({ name: "Acme" });
    expect(manager.getWindowIconPath()).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty configured product name", () => {
    expect(() =>
      createManager({
        branding: {
          name: "   ",
        },
      }),
    ).toThrow("branding.name must be a non-empty string");
  });
});
