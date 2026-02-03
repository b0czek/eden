import type { AppGrantDefinition, ResolvedGrant } from "@edenapp/types";
import { log } from "../logging";
import {
  type GrantPresetDefinition,
  GRANT_PRESET_LIST,
} from "./GrantPresetList";

export type { GrantPresetDefinition };

const GRANT_PRESET_MAP = new Map<string, GrantPresetDefinition>(
  GRANT_PRESET_LIST.map((preset) => [preset.id, preset]),
);

export const getGrantPreset = (
  presetId: string,
): GrantPresetDefinition | undefined => GRANT_PRESET_MAP.get(presetId);

/**
 * Resolve a preset ID to a full ResolvedGrant
 */
export const resolveGrantPreset = (
  presetId: string,
): ResolvedGrant | undefined => {
  const preset = getGrantPreset(presetId);
  if (!preset) return undefined;
  return {
    scope: "preset",
    id: preset.id,
    preset: preset.id,
    label: preset.label,
    description: preset.description,
    permissions: preset.permissions ?? [],
  };
};

/**
 * Normalize grant definitions to resolved grants.
 * - Preset grants are resolved to full definitions
 * - App grants are passed through with defaults applied
 */
export const normalizeGrantPresets = (
  grants: AppGrantDefinition[] | undefined,
  appId?: string,
): ResolvedGrant[] => {
  if (!Array.isArray(grants) || grants.length === 0) {
    return [];
  }

  const resolved: ResolvedGrant[] = [];
  for (const grant of grants) {
    if (grant.scope === "preset") {
      const presetGrant = resolveGrantPreset(grant.preset);
      if (!presetGrant) {
        if (appId) {
          log.warn(
            `Unknown grant preset "${grant.preset}" in ${appId}`,
          );
        }
        continue;
      }
      resolved.push(presetGrant);
      continue;
    }

    // App grant - normalize to ResolvedGrant shape
    resolved.push({
      scope: "app",
      id: grant.id,
      label: grant.label,
      description: grant.description,
      permissions: grant.permissions ?? [],
    });
  }

  return resolved;
};
