import type { SettingsCategory } from "@edenapp/types";
import type { EffectRuntime } from "../effects/runtime";
import { createEvent } from "../events/event";
import type { Settings } from "./service";

/** Promise boundary for domains awaiting their Effect conversion. */
export interface LegacySettingsAccess
  extends Pick<
    Settings,
    | "canRead"
    | "assertReadableBy"
    | "resolveGrantKey"
    | "assertAccess"
    | "filterAllowedKeys"
    | "filterSchemaByGrants"
  > {
  readonly changed: Pick<Settings["changed"], "on">;
  get(appId: string, key: string): Promise<string | undefined>;
  set(appId: string, key: string, value: string): Promise<void>;
  delete(appId: string, key: string): Promise<void>;
  list(appId: string, showRestricted?: boolean): Promise<string[]>;
  getAll(
    appId: string,
    showRestricted?: boolean,
  ): Promise<Record<string, string>>;
  reset(appId: string, key: string, schema?: SettingsCategory[]): Promise<void>;
}

export const LEGACY_SETTINGS = Symbol("Legacy settings access");

/** Legacy constructors may subscribe or request values before async startup. */
export function createLegacySettingsAccess(effects: EffectRuntime) {
  let settings: Settings | undefined;
  let stop: (() => void) | undefined;
  let disposed = false;
  let resolve!: (value: Settings) => void;
  let reject!: (error: Error) => void;
  const ready = new Promise<Settings>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  void ready.catch(() => undefined);
  const changed = createEvent<Parameters<Settings["changed"]["emit"]>[0]>();
  const requireSettings = () => {
    if (!settings) throw new Error("Settings are not initialized");
    return settings;
  };
  const access: LegacySettingsAccess = {
    get: async (appId, key) => effects.run((await ready).get(appId, key)),
    set: async (appId, key, value) =>
      effects.run((await ready).set(appId, key, value)),
    delete: async (appId, key) => effects.run((await ready).delete(appId, key)),
    list: async (appId, restricted) =>
      effects.run((await ready).list(appId, restricted)),
    getAll: async (appId, restricted) =>
      effects.run((await ready).getAll(appId, restricted)),
    reset: async (appId, key, schema) =>
      effects.run((await ready).reset(appId, key, schema)),
    changed,
    canRead: (...args) => requireSettings().canRead(...args),
    assertReadableBy: (...args) => requireSettings().assertReadableBy(...args),
    resolveGrantKey: (...args) => requireSettings().resolveGrantKey(...args),
    assertAccess: (...args) => requireSettings().assertAccess(...args),
    filterAllowedKeys: (...args) =>
      requireSettings().filterAllowedKeys(...args),
    filterSchemaByGrants: (...args) =>
      requireSettings().filterSchemaByGrants(...args),
  };
  return {
    access,
    connect(service: Settings) {
      if (disposed) throw new Error("Legacy settings access disposed");
      if (settings) throw new Error("Legacy settings access already connected");
      settings = service;
      stop = service.changed.on(changed.emit);
      resolve(service);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      reject(new Error("Eden runtime disposed before settings initialization"));
      stop?.();
      changed.dispose();
    },
  };
}
