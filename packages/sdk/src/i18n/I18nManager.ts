import { inject, injectable, singleton } from "tsyringe";
import { EdenEmitter, EdenNamespace, IPCBridge, CommandRegistry } from "../ipc";
import { SettingsManager } from "../settings/SettingsManager";
import { I18nHandler } from "./I18nHandler";
import { commonEn } from "./locales/en";
import { commonPl } from "./locales/pl";

const CommonTranslations = {
  en: commonEn,
  pl: commonPl,
};

interface I18nNamespaceEvents {
  "locale-changed": { locale: string };
}

@singleton()
@injectable()
@EdenNamespace("i18n")
export class I18nManager extends EdenEmitter<I18nNamespaceEvents> {
  private i18nHandler: I18nHandler;

  constructor(
    @inject(IPCBridge) ipcBridge: IPCBridge,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject(SettingsManager) private settingsManager: SettingsManager,
  ) {
    super(ipcBridge);

    // Create and register handler
    this.i18nHandler = new I18nHandler(this);
    commandRegistry.registerManager(this.i18nHandler);

    // Listen for locale changes
    this.ipcBridge.eventSubscribers.subscribeInternal(
      "settings/changed",
      (data) => {
        if (data.key === "general.locale") {
          this.notify("locale-changed", { locale: data.value });
        }
      },
    );
  }

  async getLocale(): Promise<string> {
    const setting = await this.settingsManager.get(
      "com.eden",
      "general.locale",
    );
    return setting || "en";
  }

  getCommon(locale: string): { translations: Record<string, any> } {
    const validLocale = locale as keyof typeof CommonTranslations;
    return {
      translations: CommonTranslations[validLocale] || CommonTranslations["en"],
    };
  }
}
