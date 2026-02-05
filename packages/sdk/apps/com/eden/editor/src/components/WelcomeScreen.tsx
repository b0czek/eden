// Document icon
function DocumentIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <line x1="16" y1="13" x2="8" y2="13"></line>
      <line x1="16" y1="17" x2="8" y2="17"></line>
      <polyline points="10 9 9 9 8 9"></polyline>
    </svg>
  );
}

interface ShortcutItemProps {
  shortcut: string;
  description: string;
}

function ShortcutItem(props: ShortcutItemProps) {
  return (
    <div class="shortcut-item">
      <span class="shortcut-key">{props.shortcut}</span>
      <span>{props.description}</span>
    </div>
  );
}

import { t } from "../i18n";

export function WelcomeScreen() {
  return (
    <div class="welcome-content">
      <div class="empty-state-icon">
        <DocumentIcon />
      </div>
      <h1>{t("editor.title")}</h1>
      <p>{t("editor.welcome")}</p>
      <div class="welcome-shortcuts">
        <ShortcutItem
          shortcut="Ctrl+S"
          description={t("editor.saveShortcut")}
        />
        <ShortcutItem
          shortcut="Ctrl+W"
          description={t("editor.closeTabShortcut")}
        />
      </div>
    </div>
  );
}
