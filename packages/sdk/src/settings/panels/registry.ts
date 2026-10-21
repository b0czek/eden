import type {
  SettingsCategory,
  SettingsPanelDefinition,
  SettingsPanelRegistration,
  SettingsPanelRegistrationOptions,
} from "@edenapp/types";
import * as Context from "effect/Context";
import { createEvent, type Event } from "../../events/event";
import { SettingsPanelRegistrationError } from "./errors";
import { cloneRendererValue } from "./serialization";
import type {
  InternalSettingsPanelProvider,
  PanelRenderer,
  PanelSource,
  SettingsPanelRecord,
} from "./types";

export interface SettingsPanelEvents {
  "panels-changed": {
    reason: "catalog" | "grants" | "session" | "state" | "visibility";
    /** Limits a state refresh to one panel when supplied. */
    panelId?: string;
  };
}
export interface PanelRegistry {
  panels: Map<string, SettingsPanelRecord>;
  changed: Event<SettingsPanelEvents["panels-changed"]>;
  register(
    definition: SettingsPanelDefinition,
    provider: InternalSettingsPanelProvider,
    source: PanelSource,
    renderer: PanelRenderer,
    ownerAppId?: string,
    generatedSettings?: SettingsCategory[],
    visible?: boolean,
  ): SettingsPanelRegistration;
  registerPanel(
    definition: SettingsPanelDefinition,
    provider: InternalSettingsPanelProvider,
    options?: SettingsPanelRegistrationOptions,
  ): SettingsPanelRegistration;
  dispose(): void;
}

export const PanelRegistryService = Context.Service<
  "eden/PanelRegistryService",
  PanelRegistry
>("eden/PanelRegistryService");

/** Synchronous host registrations have a lifetime independent of service startup. */
export function createPanelRegistry(): PanelRegistry {
  const changed = createEvent<SettingsPanelEvents["panels-changed"]>();
  const panels = new Map<string, SettingsPanelRecord>();
  let disposed = false;
  function registerPanel(
    definition: SettingsPanelDefinition,
    provider: InternalSettingsPanelProvider,
    options: SettingsPanelRegistrationOptions = {},
  ): SettingsPanelRegistration {
    if (definition.id.startsWith("eden.") || definition.id.startsWith("app.")) {
      throw new SettingsPanelRegistrationError({
        panelId: definition.id,
        message: `Panel ID "${definition.id}" uses an Eden-reserved prefix`,
      });
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
    definition: SettingsPanelDefinition,
    provider: InternalSettingsPanelProvider,
    source: PanelSource,
    renderer: PanelRenderer,
    ownerAppId?: string,
    generatedSettings?: SettingsCategory[],
    visible = true,
  ): SettingsPanelRegistration {
    if (disposed)
      throw new SettingsPanelRegistrationError({
        panelId: definition.id,
        message: "Settings panel registrations are closed",
      });
    const cloned = cloneRendererValue(definition);
    if (panels.has(cloned.id)) {
      throw new SettingsPanelRegistrationError({
        panelId: definition.id,
        message: `Settings panel "${cloned.id}" is already registered`,
      });
    }
    if (cloned.parentId === cloned.id) {
      throw new SettingsPanelRegistrationError({
        panelId: definition.id,
        message: `Settings panel "${cloned.id}" cannot be its own parent`,
      });
    }
    if (cloned.parentId && !panels.has(cloned.parentId)) {
      throw new SettingsPanelRegistrationError({
        panelId: definition.id,
        message: `Parent settings panel "${cloned.parentId}" must be registered first`,
      });
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
        throw new SettingsPanelRegistrationError({
          panelId: definition.id,
          message: `Settings panel "${cloned.id}" must share its parent's ownership domain`,
        });
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
        throw new SettingsPanelRegistrationError({
          panelId: definition.id,
          message: `Settings panel "${cloned.id}" cannot be unregistered while child panel "${child.definition.id}" remains registered`,
        });
      }
      active = false;
      panels.delete(cloned.id);
      changed.emit({ reason: "catalog" });
    };
    return Object.freeze({
      panelId: cloned.id,
      invalidate: () => {
        if (!active) {
          throw new SettingsPanelRegistrationError({
            panelId: definition.id,
            message: `Settings panel "${cloned.id}" is unregistered`,
          });
        }
        const record = panels.get(cloned.id);
        if (!record || record.token !== token) {
          throw new SettingsPanelRegistrationError({
            panelId: definition.id,
            message: `Settings panel "${cloned.id}" is stale`,
          });
        }
        changed.emit({
          reason: "state",
          panelId: cloned.id,
        });
      },
      setVisible: (nextVisible: boolean) => {
        if (!active) {
          throw new SettingsPanelRegistrationError({
            panelId: definition.id,
            message: `Settings panel "${cloned.id}" is unregistered`,
          });
        }
        const record = panels.get(cloned.id);
        if (!record || record.token !== token) {
          throw new SettingsPanelRegistrationError({
            panelId: definition.id,
            message: `Settings panel "${cloned.id}" is stale`,
          });
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
