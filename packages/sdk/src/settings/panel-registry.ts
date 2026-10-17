import type {
  SettingsCategory,
  SettingsPanelDefinition,
  SettingsPanelRegistration,
  SettingsPanelRegistrationOptions,
} from "@edenapp/types";
import { createEvent } from "../events/event";
import {
  cloneRendererValue,
  type InternalPanelDefinition,
} from "./panel-codec";
import type {
  InternalSettingsPanelProvider,
  PanelRenderer,
  PanelSource,
  SettingsPanelRecord,
} from "./panel-record";

export interface SettingsPanelEvents {
  "panels-changed": {
    reason: "catalog" | "grants" | "session" | "state" | "visibility";
    /** Limits a state refresh to one panel when supplied. */
    panelId?: string;
  };
}

/** Synchronous host registrations have a lifetime independent of service startup. */
export function createPanelRegistry() {
  const changed = createEvent<SettingsPanelEvents["panels-changed"]>();
  const panels = new Map<string, SettingsPanelRecord>();
  let disposed = false;
  function registerPanel(
    definition: SettingsPanelDefinition,
    provider: InternalSettingsPanelProvider,
    options: SettingsPanelRegistrationOptions = {},
  ): SettingsPanelRegistration {
    if (definition.id.startsWith("eden.") || definition.id.startsWith("app.")) {
      throw new Error(
        `Panel ID "${definition.id}" uses an Eden-reserved prefix`,
      );
    }
    return register(
      definition,
      provider,
      "host",
      "generic",
      undefined,
      undefined,
      options.visible,
    );
  }
  function register(
    definition: InternalPanelDefinition,
    provider: InternalSettingsPanelProvider,
    source: PanelSource,
    renderer: PanelRenderer,
    ownerAppId?: string,
    generatedSettings?: SettingsCategory[],
    visible = true,
  ): SettingsPanelRegistration {
    if (disposed) throw new Error("Settings panel registrations are closed");
    const cloned = cloneRendererValue(definition);
    if (panels.has(cloned.id)) {
      throw new Error(`Settings panel "${cloned.id}" is already registered`);
    }
    if (cloned.parentId === cloned.id) {
      throw new Error(`Settings panel "${cloned.id}" cannot be its own parent`);
    }
    if (cloned.parentId && !panels.has(cloned.parentId)) {
      throw new Error(
        `Parent settings panel "${cloned.parentId}" must be registered first`,
      );
    }
    if (cloned.parentId) {
      const parent = panels.get(cloned.parentId);
      const sameDomain =
        parent &&
        ((source === "host" && parent.source === "host") ||
          (source === "eden" && parent.source === "eden") ||
          (source === "application" &&
            parent.source === "application" &&
            ownerAppId === parent.ownerAppId));
      if (!sameDomain)
        throw new Error(
          `Settings panel "${cloned.id}" must share its parent's ownership domain`,
        );
    }
    const trustedProvider: InternalSettingsPanelProvider = Object.freeze({
      load: provider.load.bind(provider),
      actions: Object.freeze(
        Object.fromEntries(
          Object.entries(provider.actions ?? {}).map(([id, handler]) => [
            id,
            handler.bind(provider),
          ]),
        ),
      ),
    });

    const token = Symbol(cloned.id);
    panels.set(cloned.id, {
      definition: cloned,
      provider: trustedProvider,
      source,
      renderer,
      ownerAppId,
      generatedSettings,
      token,
      visible,
    });
    changed.emit({ reason: "catalog" });

    let active = true;
    const unregister = () => {
      if (!active) return;
      if (panels.get(cloned.id)?.token !== token) {
        active = false;
        return;
      }
      const child = Array.from(panels.values()).find(
        (record) => record.definition.parentId === cloned.id,
      );
      if (child) {
        throw new Error(
          `Settings panel "${cloned.id}" cannot be unregistered while child panel "${child.definition.id}" remains registered`,
        );
      }
      active = false;
      panels.delete(cloned.id);
      changed.emit({ reason: "catalog" });
    };
    return Object.freeze({
      panelId: cloned.id,
      invalidate: () => {
        if (!active) {
          throw new Error(`Settings panel "${cloned.id}" is unregistered`);
        }
        const record = panels.get(cloned.id);
        if (!record || record.token !== token) {
          throw new Error(`Settings panel "${cloned.id}" is stale`);
        }
        changed.emit({
          reason: "state",
          panelId: cloned.id,
        });
      },
      setVisible: (nextVisible: boolean) => {
        if (!active) {
          throw new Error(`Settings panel "${cloned.id}" is unregistered`);
        }
        const record = panels.get(cloned.id);
        if (!record || record.token !== token) {
          throw new Error(`Settings panel "${cloned.id}" is stale`);
        }
        if (record.visible === nextVisible) return;
        record.visible = nextVisible;
        changed.emit({ reason: "visibility" });
      },
      unregister,
    });
  }
  return {
    panels,
    changed,
    register,
    registerPanel,
    dispose: () => {
      disposed = true;
      panels.clear();
      changed.dispose();
    },
  };
}
export type PanelRegistry = ReturnType<typeof createPanelRegistry>;
