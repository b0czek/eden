import type {
  SettingDefinition,
  SettingsCategory,
  SettingsPanelActionDefinition,
  SettingsPanelActionInputSchema,
  SettingsPanelDefinition,
  SettingsPanelNode,
  SettingsPanelProvider,
  SettingsPanelValue,
  UserProfile,
} from "@edenapp/types";
import type { SettingsManager } from "./SettingsManager";
import {
  cloneAndValidatePanelView,
  cloneRendererValue,
  type InternalPanelDefinition,
} from "./SettingsPanelCodec";

export interface GeneratedPanelOwner {
  id: string;
  name: SettingsPanelDefinition["title"];
  description?: SettingsPanelDefinition["description"];
  icon?: string;
  settings?: SettingsCategory[];
}
export interface GeneratedSettingsPanel {
  definition: InternalPanelDefinition;
  provider: SettingsPanelProvider;
  ownerAppId: string;
  settings: SettingsCategory[];
}
export const settingGrant = (
  ownerAppId: string,
  setting: SettingDefinition,
): string => `settings/${ownerAppId}/${setting.grant ?? setting.key}`;
const actionId = (categoryIndex: number, settingIndex: number): string =>
  `set.${categoryIndex}.${settingIndex}`;

const valueSchema = (
  setting: SettingDefinition,
): SettingsPanelActionInputSchema => {
  if (setting.type === "toggle" || setting.type === "checkbox")
    return { type: "boolean", required: true };
  if (setting.type === "number" || setting.type === "range")
    return {
      type: "number",
      required: true,
      min: setting.min,
      max: setting.max,
    };
  if (setting.type === "select" || setting.type === "radio")
    return {
      type: "string",
      required: true,
      enum: setting.options?.map(({ value }) => value),
    };
  return { type: "string", required: true };
};

const parseValue = (
  setting: SettingDefinition,
  value: string | undefined,
): SettingsPanelValue => {
  const effective = value ?? setting.defaultValue ?? "";
  if (setting.type === "toggle" || setting.type === "checkbox")
    return effective === "true";
  if (setting.type === "number" || setting.type === "range") {
    const numeric = Number(effective);
    return Number.isFinite(numeric) ? numeric : 0;
  }
  return effective;
};

const resolvedNode = (
  setting: SettingDefinition,
  categoryIndex: number,
  settingIndex: number,
  value: SettingsPanelValue,
): SettingsPanelNode => {
  const common = {
    id: `setting.${categoryIndex}.${settingIndex}`,
    label: setting.label,
    description: setting.description,
    action: { actionId: actionId(categoryIndex, settingIndex) },
  };
  if (setting.type === "toggle")
    return { ...common, kind: "toggle", value: value as boolean };
  if (setting.type === "checkbox")
    return {
      ...common,
      kind: "input",
      input: "checkbox",
      value: value as boolean,
      validation: { min: setting.min, max: setting.max, step: setting.step },
    };
  if (setting.type === "select" || setting.type === "radio")
    return {
      ...common,
      kind: "input",
      input: setting.type,
      value: value as string,
      options: setting.options ?? [],
      placeholder: setting.placeholder,
      validation: { min: setting.min, max: setting.max, step: setting.step },
    };
  if (setting.type === "number" || setting.type === "range")
    return {
      ...common,
      kind: "input",
      input: setting.type,
      value: value as number,
      placeholder: setting.placeholder,
      validation: { min: setting.min, max: setting.max, step: setting.step },
    };
  return {
    ...common,
    kind: "input",
    input: setting.type,
    value: value as string,
    placeholder: setting.placeholder,
    validation: { min: setting.min, max: setting.max, step: setting.step },
  };
};

export function createGeneratedSettingsPanel(
  panelId: string,
  owner: GeneratedPanelOwner,
  source: "eden" | "application",
  settingsManager: SettingsManager,
  hasGrant: (user: UserProfile, grant: string) => boolean,
): GeneratedSettingsPanel {
  const settings = cloneRendererValue(owner.settings ?? []);
  const actions: SettingsPanelActionDefinition[] = [];
  const handlers: NonNullable<SettingsPanelProvider["actions"]> = {};
  settings.forEach((category, categoryIndex) => {
    category.settings.forEach((setting, settingIndex) => {
      const id = actionId(categoryIndex, settingIndex);
      actions.push({
        id,
        grant: settingGrant(owner.id, setting),
        label: setting.label,
        value: valueSchema(setting),
      });
      handlers[id] = async (invocation) => {
        await settingsManager.set(
          owner.id,
          setting.key,
          String(invocation.value),
        );
      };
    });
  });
  const definition: InternalPanelDefinition = {
    id: panelId,
    title: owner.name,
    description: owner.description,
    icon: source === "eden" ? owner.icon : undefined,
    actions,
  };
  cloneAndValidatePanelView(definition, {
    sections: settings.map((category) => ({
      id: category.id,
      title: category.name,
      description: category.description,
      nodes: [],
    })),
  });
  return {
    definition,
    provider: {
      load: async (context) => ({
        sections: (
          await Promise.all(
            settings.map(async (category, categoryIndex) => ({
              id: category.id,
              title: category.name,
              description: category.description,
              nodes: (
                await Promise.all(
                  category.settings.map(async (setting, settingIndex) => {
                    if (
                      !hasGrant(context.user, settingGrant(owner.id, setting))
                    )
                      return undefined;
                    return resolvedNode(
                      setting,
                      categoryIndex,
                      settingIndex,
                      parseValue(
                        setting,
                        await settingsManager.get(owner.id, setting.key),
                      ),
                    );
                  }),
                )
              ).filter((node): node is SettingsPanelNode => node !== undefined),
            })),
          )
        ).filter((section) => section.nodes.length > 0),
      }),
      actions: handlers,
    },
    ownerAppId: owner.id,
    settings,
  };
}
