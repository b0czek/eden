import type { I18nCommonTranslations } from "@edenapp/babel/generated/i18n";
import { setupI18n } from "@edenapp/babel/solid";
import type { InferTranslations } from "@edenapp/babel/types";
import type { FileExplorerLabels } from "@edenapp/files-core";
import { en } from "./locales/en";
import { pl } from "./locales/pl";

// Infer app types from the English locale import
type AppTranslations = InferTranslations<typeof en>;

// Merge with common SDK translations
type AllTranslations = I18nCommonTranslations & AppTranslations;

// App specific resources
const resources = {
  en: { translation: en },
  pl: { translation: pl },
};

// Fully typed!
export const { t, locale, setLocale, initLocale } = setupI18n<AllTranslations>({
  resources,
});

export const getExplorerLabels = (volume = "home"): FileExplorerLabels => ({
  volume: t("files.volume"),
  home: t("files.home"),
  readOnly: t("files.readOnly"),
  refresh: t("files.refresh"),
  goBack: t("files.goBack"),
  goForward: t("files.goForward"),
  goUp: t("files.goUp"),
  newFolder: t("files.newFolder"),
  newFile: t("files.newFile"),
  settings: t("common.settings"),
  editPath: t("files.editPath"),
  searchPlaceholder: t("files.searchPlaceholder"),
  loading: t("common.loading"),
  empty: t("files.empty"),
  emptyHint: t("files.emptyHint"),
  folder: t("files.folder"),
  delete:
    volume === "home" ? t("files.moveToTrash") : t("files.deletePermanently"),
  close: t("common.close"),
  displayOptions: t("files.displayOptions"),
  viewStyle: t("files.viewStyle"),
  grid: t("files.grid"),
  list: t("files.list"),
  displaySize: t("files.displaySize"),
  tiny: t("files.tiny"),
  small: t("files.small"),
  medium: t("files.medium"),
  large: t("files.large"),
  huge: t("files.huge"),
  sortBy: t("files.sortBy"),
  name: t("common.name"),
  size: t("common.size"),
  modified: t("files.modified"),
  ascending: t("files.ascending"),
  descending: t("files.descending"),
  selectItem: t("files.select"),
});
