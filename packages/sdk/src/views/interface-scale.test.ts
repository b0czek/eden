import type { AppManifest } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { createEffectRuntime } from "../effects/runtime";
import { createEvent } from "../events/event";
import { createInterfaceScale } from "./interface-scale";
import type { ViewInfo, ViewType } from "./types";

type SettingsChanged = {
  appId: string;
  key: string;
  value: string;
};

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
const createController = async (
  views: ViewInfo[] = [],
  notifyScaleChanged = jest.fn(),
  initialScale: string | null = null,
) => {
  const changed = createEvent<SettingsChanged>();
  const settings = {
    get: jest.fn(() => Effect.succeed(initialScale ?? undefined)),
    changed,
  };

  const effects = createEffectRuntime();
  cleanups.unshift(() => effects.dispose());
  const controller = await effects.acquire(
    createInterfaceScale(settings as never, () => views, notifyScaleChanged),
  );

  return {
    controller,
    initialize: () => effects.run(controller.initialize()),
    notifyScaleChanged,
    emitSettingsChanged: (value: string) =>
      changed.emit({
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

describe("InterfaceScale", () => {
  it("applies scale automatically to regular app views", async () => {
    const view = createView("app");
    const { controller } = await createController([view]);

    controller.setScale(1.5);

    expect(getSetZoomFactor(view)).toHaveBeenCalledWith(1.5);
  });

  it("keeps overlay views manual by default", async () => {
    const view = createView("overlay");
    const { controller } = await createController([view]);

    controller.setScale(1.5);

    expect(getSetZoomFactor(view)).not.toHaveBeenCalled();
  });

  it("applies scale to overlay views that opt into auto scaling", async () => {
    const view = createView("overlay", {
      mode: "floating",
      scaling: "auto",
    });
    const { controller } = await createController([view]);

    controller.setScale(1.5);

    expect(getSetZoomFactor(view)).toHaveBeenCalledWith(1.5);
  });

  it("notifies when the effective interface scale changes", async () => {
    const notifyScaleChanged = jest.fn();
    const { emitSettingsChanged } = await createController(
      [],
      notifyScaleChanged,
    );

    emitSettingsChanged("1.25");

    expect(notifyScaleChanged).toHaveBeenCalledWith(1.25, 1);
  });

  it("applies an asynchronously initialized scale to views already created", async () => {
    const view = createView("app");
    const notifyScaleChanged = jest.fn();

    await (
      await createController([view], notifyScaleChanged, "1.5")
    ).initialize();

    expect(getSetZoomFactor(view)).toHaveBeenCalledWith(1.5);
    expect(notifyScaleChanged).toHaveBeenCalledWith(1.5, 1);
  });
});
