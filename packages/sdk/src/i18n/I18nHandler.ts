import { EdenHandler, EdenNamespace } from "../ipc";
import { I18nManager } from "./I18nManager";

@EdenNamespace("i18n")
export class I18nHandler {
  constructor(private i18nManager: I18nManager) {}

  @EdenHandler("get-locale")
  async handleGetLocale(): Promise<{ locale: string }> {
    const locale = await this.i18nManager.getLocale();
    return { locale };
  }

  @EdenHandler("get-common")
  handleGetCommon(args: { locale: string }): { translations: Record<string, any> } {
    return this.i18nManager.getCommon(args.locale);
  }
}
