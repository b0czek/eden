import type {
  SettingsPanelLocalizedText,
  SettingsPanelNode,
  SettingsPanelView,
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
  ancestors: readonly SettingsPanelRecord[] = [],
): boolean {
  if (ancestors.some((ancestor) => !canOpenPanel(ancestor, user))) return false;
  if (!record.visible) return false;
  if (record.definition.grant)
    return hasUserGrant(user, record.definition.grant);
  if (record.source === "host") return true;
  if (!record.generatedSettings || !record.ownerAppId) return false;
  return record.generatedSettings.some((category) =>
    category.settings.some((setting) =>
      hasUserGrant(user, settingGrant(record.ownerAppId as string, setting)),
    ),
  );
}

export const actionAuthorization = (
  record: SettingsPanelRecord,
  user: UserProfile,
) =>
  (record.definition.actions ?? []).map((action) => ({
    id: action.id,
    authorized: !action.grant || hasUserGrant(user, action.grant),
  }));

export function applyActionAuthorization(
  view: SettingsPanelView,
  access: ReadonlyMap<string, boolean>,
): SettingsPanelView {
  const authorize = (node: SettingsPanelNode): SettingsPanelNode => {
    if (node.kind === "collection") {
      return {
        ...node,
        items: node.items.map((item) => ({
          ...item,
          nodes: item.nodes.map((child) =>
            child.kind === "status" ||
            access.get(child.action.actionId) !== false
              ? child
              : { ...child, disabled: true },
          ),
        })),
      };
    }
    return node.kind === "status" || access.get(node.action.actionId) !== false
      ? node
      : { ...node, disabled: true };
  };
  return {
    sections: view.sections.map((section) => ({
      ...section,
      nodes: section.nodes.map(authorize),
    })),
  };
}

const joinLocalized = (
  first: SettingsPanelLocalizedText,
  second: SettingsPanelLocalizedText,
): SettingsPanelLocalizedText => {
  if (typeof first === "string" && typeof second === "string")
    return `${first} · ${second}`;
  const locales = new Set([
    ...(typeof first === "string" ? [] : Object.keys(first)),
    ...(typeof second === "string" ? [] : Object.keys(second)),
  ]);
  const resolve = (value: typeof first, locale: string) =>
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
    if (option.grant.trim() && !options.has(option.grant))
      options.set(option.grant, cloneRendererValue(option));
  };
  for (const record of records) {
    const ownerId = record.ownerAppId ?? record.definition.id;
    const ownerLabel = record.definition.title;
    if (record.definition.grant)
      add({
        grant: record.definition.grant,
        kind: "panel",
        label: record.definition.title,
        description: record.definition.description,
        ownerId,
        ownerLabel,
      });
    for (const category of record.generatedSettings ?? [])
      for (const setting of category.settings)
        add({
          grant: settingGrant(ownerId, setting),
          kind: "setting",
          label: joinLocalized(category.name, setting.label),
          description: setting.description,
          ownerId,
          ownerLabel,
        });
    for (const action of record.definition.actions ?? [])
      if (action.grant && action.label)
        add({
          grant: action.grant,
          kind: "panel-action",
          label: action.label,
          description: action.description,
          ownerId,
          ownerLabel,
        });
  }
  return Array.from(options.values());
}
