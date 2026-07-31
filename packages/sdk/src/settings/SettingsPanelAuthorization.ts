import type {
  SettingsPanelControl,
  SettingsPanelDeclaration,
  SettingsPanelLocalizedText,
  SettingsPanelState,
  UserGrantOption,
  UserProfile,
} from "@edenapp/types";
import { matchesGrants } from "../user/UserGrants";
import { settingGrant } from "./GeneratedSettingsPanel";
import { cloneRendererValue } from "./SettingsPanelCodec";
import type { SettingsPanelRecord } from "./SettingsPanelRecord";

export const hasUserGrant = (user: UserProfile, grant: string): boolean =>
  user.role === "vendor" || matchesGrants(user.grants, grant);

export function canOpenPanel(
  record: SettingsPanelRecord,
  user: UserProfile,
): boolean {
  if (!record.visible) return false;
  if (record.definition.grant) {
    return hasUserGrant(user, record.definition.grant);
  }
  if (!record.generatedSettings || !record.ownerAppId) return false;
  return record.generatedSettings.some((category) =>
    category.settings.some((setting) =>
      hasUserGrant(user, settingGrant(record.ownerAppId as string, setting)),
    ),
  );
}

export function authorizePanelDeclaration(
  record: SettingsPanelRecord,
  user: UserProfile,
): SettingsPanelDeclaration | undefined {
  if (!canOpenPanel(record, user)) return undefined;
  const sections = record.generatedSettings
    ? record.definition.sections
        .map((section, categoryIndex) => ({
          ...section,
          controls: section.controls.filter((_, settingIndex) => {
            const setting =
              record.generatedSettings?.[categoryIndex]?.settings[settingIndex];
            return (
              !!setting &&
              !!record.ownerAppId &&
              hasUserGrant(user, settingGrant(record.ownerAppId, setting))
            );
          }),
        }))
        .filter((section) => section.controls.length > 0)
    : record.definition.sections;
  if (record.generatedSettings && sections.length === 0) return undefined;

  return {
    id: record.definition.id,
    title: record.definition.title,
    description: record.definition.description,
    icon: record.definition.icon,
    source: record.source,
    renderer: record.renderer,
    sections,
    actions: (record.definition.actions ?? []).map((action) => ({
      id: action.id,
      authorized: !action.grant || hasUserGrant(user, action.grant),
    })),
  };
}

export function applyActionAuthorization(
  state: SettingsPanelState,
  declaration: SettingsPanelDeclaration,
): SettingsPanelState {
  const controls = { ...(state.controls ?? {}) };
  const actionAccess = new Map(
    declaration.actions.map((action) => [action.id, action.authorized]),
  );
  for (const section of declaration.sections) {
    for (const control of section.controls) {
      if (!("actionId" in control)) continue;
      if (actionAccess.get(control.actionId) !== false) continue;
      const stateKey = "stateKey" in control ? control.stateKey : control.id;
      controls[stateKey] = { ...controls[stateKey], disabled: true };
    }
  }
  return { ...state, controls };
}

const findActionControl = (
  record: SettingsPanelRecord,
  actionId: string,
): SettingsPanelControl | undefined => {
  for (const section of record.definition.sections) {
    const control = section.controls.find(
      (candidate) => "actionId" in candidate && candidate.actionId === actionId,
    );
    if (control) return control;
  }
  return undefined;
};

const joinLocalized = (
  first: SettingsPanelLocalizedText,
  second: SettingsPanelLocalizedText,
): SettingsPanelLocalizedText => {
  if (typeof first === "string" && typeof second === "string") {
    return `${first} · ${second}`;
  }
  const locales = new Set([
    ...(typeof first === "string" ? [] : Object.keys(first)),
    ...(typeof second === "string" ? [] : Object.keys(second)),
  ]);
  const resolve = (value: SettingsPanelLocalizedText, locale: string) =>
    typeof value === "string"
      ? value
      : (value[locale] ?? value.en ?? Object.values(value)[0] ?? "");
  return Object.fromEntries(
    Array.from(locales).map((locale) => [
      locale,
      `${resolve(first, locale)} · ${resolve(second, locale)}`,
    ]),
  );
};

export function collectPanelGrantOptions(
  records: Iterable<SettingsPanelRecord>,
): UserGrantOption[] {
  const options = new Map<string, UserGrantOption>();
  const add = (option: UserGrantOption) => {
    if (!option.grant.trim() || options.has(option.grant)) return;
    options.set(option.grant, cloneRendererValue(option));
  };
  for (const record of records) {
    const ownerId = record.ownerAppId ?? record.definition.id;
    const ownerLabel = record.definition.title;
    if (record.definition.grant) {
      add({
        grant: record.definition.grant,
        kind: "panel",
        label: record.definition.title,
        description: record.definition.description,
        ownerId,
        ownerLabel,
      });
    }
    for (const category of record.generatedSettings ?? []) {
      for (const setting of category.settings) {
        add({
          grant: settingGrant(ownerId, setting),
          kind: "setting",
          label: joinLocalized(category.name, setting.label),
          description: setting.description,
          ownerId,
          ownerLabel,
        });
      }
    }
    for (const action of record.definition.actions ?? []) {
      if (!action.grant) continue;
      const control = findActionControl(record, action.id);
      add({
        grant: action.grant,
        kind: "panel-action",
        label: action.label ?? control?.label ?? action.id,
        description: action.description ?? control?.description,
        ownerId,
        ownerLabel,
      });
    }
  }
  return Array.from(options.values());
}
