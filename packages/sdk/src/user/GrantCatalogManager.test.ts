import "reflect-metadata";
import type { RuntimeAppManifest, UserGrantOption } from "@edenapp/types";
import type { AppCatalog } from "../app-registry";
import type { IPCBridge } from "../ipc";
import type { PackageManager } from "../package-manager";
import type { SettingsPanelManager } from "../settings";
import { GrantCatalogManager } from "./GrantCatalogManager";

const emitter = () => {
  const listeners = new Map<string, Array<(payload: never) => void>>();
  return {
    on: jest.fn((event: string, listener: (payload: never) => void) => {
      const current = listeners.get(event) ?? [];
      current.push(listener);
      listeners.set(event, current);
      return () =>
        listeners.set(
          event,
          current.filter((item) => item !== listener),
        );
    }),
    emit(event: string, payload: unknown) {
      for (const listener of listeners.get(event) ?? [])
        listener(payload as never);
    },
  };
};

const app = {
  id: "com.example.app",
  name: "Example",
  description: "Example app",
  version: "1.0.0",
  isPrebuilt: false,
  isDevelopment: false,
  isCore: false,
  isRestricted: false,
  resolvedGrants: [
    {
      scope: "preset",
      id: "network/manage",
      preset: "network/manage",
      label: "Network",
      permissions: ["network/manage"],
    },
    {
      scope: "app",
      id: "advanced",
      label: "Advanced",
      permissions: ["app/advanced"],
    },
  ],
} as RuntimeAppManifest;

describe("GrantCatalogManager", () => {
  it("combines and deduplicates app and panel grants", () => {
    const packages = emitter();
    const panels = emitter();
    const panelOptions: UserGrantOption[] = [
      {
        grant: "preset/network/manage",
        kind: "panel",
        label: "Duplicate panel grant",
      },
      {
        grant: "panels/runtime",
        kind: "panel",
        label: "Runtime panel",
      },
    ];
    const manager = new GrantCatalogManager(
      { eventSubscribers: { notify: jest.fn() } } as unknown as IPCBridge,
      { all: () => [app] } as unknown as AppCatalog,
      {
        on: panels.on,
        listGrantOptions: () => panelOptions,
      } as unknown as SettingsPanelManager,
      { on: packages.on } as unknown as PackageManager,
    );

    expect(manager.getOptions().options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          grant: "apps/launch/com.example.app",
          kind: "app-launch",
        }),
        expect.objectContaining({
          grant: "preset/network/manage",
          kind: "preset",
          label: "Network",
        }),
        expect.objectContaining({
          grant: "app/com.example.app/advanced",
          kind: "app-feature",
        }),
        expect.objectContaining({ grant: "panels/runtime", kind: "panel" }),
      ]),
    );
    expect(
      manager
        .getOptions()
        .options.filter((option) => option.grant === "preset/network/manage"),
    ).toHaveLength(1);
  });

  it("coalesces runtime catalog invalidations", async () => {
    const packages = emitter();
    const panels = emitter();
    const notify = jest.fn();
    const manager = new GrantCatalogManager(
      { eventSubscribers: { notify } } as unknown as IPCBridge,
      { all: () => [] } as unknown as AppCatalog,
      {
        on: panels.on,
        listGrantOptions: () => [],
      } as unknown as SettingsPanelManager,
      { on: packages.on } as unknown as PackageManager,
    );

    panels.emit("panels-changed", { reason: "catalog" });
    packages.emit("installed", { manifest: app });
    panels.emit("panels-changed", { reason: "visibility" });
    await Promise.resolve();

    expect(manager.getOptions().revision).toBe(2);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("user/grant-options-changed", {
      revision: 2,
    });
  });
});
