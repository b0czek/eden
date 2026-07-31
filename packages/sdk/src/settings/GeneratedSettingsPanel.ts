import type {
  SettingDefinition,
  SettingsCategory,
  SettingsPanelActionDefinition,
  SettingsPanelActionInputSchema,
  SettingsPanelControl,
  SettingsPanelDefinition,
  SettingsPanelProvider,
  SettingsPanelSection,
  SettingsPanelState,
  SettingsPanelValue,
  UserProfile,
} from "@edenapp/types";
import type { SettingsManager } from "./SettingsManager";
import {
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

const stateKey = (setting: SettingDefinition): string =>
  `setting:${setting.key}`;

const valueSchema = (
  setting: SettingDefinition,
): SettingsPanelActionInputSchema => {
  if (setting.type === "toggle" || setting.type === "checkbox") {
    return { type: "boolean", required: true };
  }
  if (setting.type === "number" || setting.type === "range") {
    return {
      type: "number",
      required: true,
      min: setting.min,
      max: setting.max,
    };
  }
  if (setting.type === "select" || setting.type === "radio") {
    return {
      type: "string",
      required: true,
      enum: setting.options?.map((option) => option.value),
    };
  }
  return { type: "string", required: true };
};

const control = (
  setting: SettingDefinition,
  categoryIndex: number,
  settingIndex: number,
): SettingsPanelControl => {
  const common = {
    id: `setting.${categoryIndex}.${settingIndex}`,
    label: setting.label,
    description: setting.description,
    stateKey: stateKey(setting),
    actionId: actionId(categoryIndex, settingIndex),
  };
  if (setting.type === "toggle" || setting.type === "checkbox") {
    return { ...common, kind: "toggle" };
  }
  return {
    ...common,
    kind: "input",
    input: setting.type,
    placeholder: setting.placeholder,
    options: setting.options,
    validation: { min: setting.min, max: setting.max, step: setting.step },
  };
};

const parseValue = (
  setting: SettingDefinition,
  value: string | undefined,
): SettingsPanelValue => {
  const effective = value ?? setting.defaultValue ?? "";
  if (setting.type === "toggle" || setting.type === "checkbox") {
    return effective === "true";
  }
  if (setting.type === "number" || setting.type === "range") {
    const numeric = Number(effective);
    return Number.isFinite(numeric) ? numeric : 0;
  }
  return effective;
};

export function createGeneratedSettingsPanel(
  panelId: string,
  owner: GeneratedPanelOwner,
  source: "eden" | "application",
  settingsManager: SettingsManager,
  hasGrant: (user: UserProfile, grant: string) => boolean,
): GeneratedSettingsPanel {
  const settings = cloneRendererValue(owner.settings ?? []);
  const sections: SettingsPanelSection[] = settings.map(
    (category, categoryIndex) => ({
      id: category.id,
      title: category.name,
      description: category.description,
      controls: category.settings.map((setting, settingIndex) =>
        control(setting, categoryIndex, settingIndex),
      ),
    }),
  );
  const actions: SettingsPanelActionDefinition[] = [];
  const handlers: NonNullable<SettingsPanelProvider["actions"]> = {};

  settings.forEach((category, categoryIndex) => {
    category.settings.forEach((setting, settingIndex) => {
      const id = actionId(categoryIndex, settingIndex);
      actions.push({
        id,
        grant: settingGrant(owner.id, setting),
        input: {
          type: "object",
          required: true,
          properties: { value: valueSchema(setting) },
          additionalProperties: false,
        },
      });
      handlers[id] = async (input) => {
        const value = (input as { value: SettingsPanelValue }).value;
        await settingsManager.set(owner.id, setting.key, String(value));
      };
    });
  });

  return {
    definition: {
      id: panelId,
      title: owner.name,
      description: owner.description,
      icon: source === "eden" ? owner.icon : undefined,
      sections,
      actions,
    },
    provider: {
      load: async (context) => {
        const controls: NonNullable<SettingsPanelState["controls"]> = {};
        for (const category of settings) {
          for (const setting of category.settings) {
            if (!hasGrant(context.user, settingGrant(owner.id, setting)))
              continue;
            const value = await settingsManager.get(owner.id, setting.key);
            controls[stateKey(setting)] = { value: parseValue(setting, value) };
          }
        }
        return { controls };
      },
      actions: handlers,
    },
    ownerAppId: owner.id,
    settings,
  };
}
