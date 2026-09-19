import type {
  SettingsPanelActionBinding,
  SettingsPanelLocalizedText,
} from "@edenapp/types";
import { getLocalizedValue, locale } from "../../i18n";

export const localized = (value?: SettingsPanelLocalizedText) =>
  value ? getLocalizedValue(value, locale()) : "";

export const badgeClass = (tone?: string) =>
  tone && tone !== "neutral" ? ` eden-badge-${tone}` : "";

export const withParams = (binding: SettingsPanelActionBinding) =>
  binding.params === undefined ? {} : { params: binding.params };
