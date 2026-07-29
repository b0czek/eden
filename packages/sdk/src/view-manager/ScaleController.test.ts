import "reflect-metadata";

import type { AppManifest } from "@edenapp/types";
import { ScaleController } from "./ScaleController";
import type { ViewInfo, ViewType } from "./types";

type SettingsChangedCallback = (data: {
  appId: string;
  key: string;
  value: string;
}) => void;

const createController = (
  views: ViewInfo[] = [],
  notifyScaleChanged = jest.fn(),
) => {
  let settingsChangedCallback: SettingsChangedCallback | undefined;
  const settingsManager = {
    get: jest.fn().mockResolvedValue(null),
    on: jest.fn((_event: string, callback: SettingsChangedCallback) => {
      settingsChangedCallback = callback;
      return jest.fn();
    }),
  };

  const controller = new ScaleController(
    settingsManager as never,
    () => views,
    notifyScaleChanged,
  );

  return {
    controller,
    notifyScaleChanged,
    emitSettingsChanged: (value: string) =>
      settingsChangedCallback?.({
        appId: "com.eden",
        key: "general.interfaceScale",
        value,
      }),
  };
};

const createView = (
  viewType: ViewType,
  windowConfig: AppManifest["window"] = { mode: "floating" },
): ViewInfo =>
  ({
    id: Math.floor(Math.random() * 1000),
    viewType,
    manifest: {
      window: windowConfig,
    } as AppManifest,
    view: {
      webContents: {
        isDestroyed: jest.fn(() => false),
        setZoomFactor: jest.fn(),
      },
    },
  }) as unknown as ViewInfo;

const getSetZoomFactor = (view: ViewInfo) =>
  view.view.webContents.setZoomFactor as jest.Mock;

describe("ScaleController", () => {
  it("applies scale automatically to regular app views", () => {
    const view = createView("app");
    const { controller } = createController([view]);

    controller.setScale(1.5);

    expect(getSetZoomFactor(view)).toHaveBeenCalledWith(1.5);
  });

  it("keeps overlay views manual by default", () => {
    const view = createView("overlay");
    const { controller } = createController([view]);

    controller.setScale(1.5);

    expect(getSetZoomFactor(view)).not.toHaveBeenCalled();
  });

  it("applies scale to overlay views that opt into auto scaling", () => {
    const view = createView("overlay", {
      mode: "floating",
      scaling: "auto",
    });
    const { controller } = createController([view]);

    controller.setScale(1.5);

    expect(getSetZoomFactor(view)).toHaveBeenCalledWith(1.5);
  });

  it("notifies when the effective interface scale changes", () => {
    const notifyScaleChanged = jest.fn();
    const { emitSettingsChanged } = createController([], notifyScaleChanged);

    emitSettingsChanged("1.25");

    expect(notifyScaleChanged).toHaveBeenCalledWith(1.25);
  });
});
