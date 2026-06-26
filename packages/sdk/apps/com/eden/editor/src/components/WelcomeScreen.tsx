import appIconUrl from "../../icon.svg?url";
import { t } from "../i18n";

interface WelcomeScreenProps {
  onOpen: () => void;
}

export function WelcomeScreen(props: WelcomeScreenProps) {
  return (
    <div class="welcome-content">
      <div class="empty-state-icon">
        <img src={appIconUrl} alt="" aria-hidden="true" />
      </div>
      <h1>{t("editor.title")}</h1>
      <p>{t("editor.welcome")}</p>
      <button
        type="button"
        class="eden-btn eden-btn-primary eden-btn-md"
        onClick={props.onOpen}
      >
        {t("editor.openFile")}
      </button>
    </div>
  );
}
