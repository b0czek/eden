import { FaSolidFloppyDisk } from "solid-icons/fa";
import type { Accessor } from "solid-js";
import { t } from "../../i18n";

interface GrantsRawModeProps {
  rawGrantText: Accessor<string>;
  onTextChange: (text: string) => void;
  onSave: () => void;
}

const GrantsRawMode = (props: GrantsRawModeProps) => (
  <div class="eden-flex eden-flex-col eden-gap-md eden-h-full">
    <div class="eden-alert eden-alert-warning">
      <span class="eden-text-sm">{t("settings.users.rawWarning")}</span>
    </div>
    <textarea
      class="eden-textarea eden-font-mono eden-scrollbar raw-grants-textarea"
      value={props.rawGrantText()}
      onInput={(e) => props.onTextChange(e.currentTarget.value)}
    />
    <button
      type="button"
      class="eden-btn eden-btn-primary eden-self-start eden-flex eden-items-center eden-gap-xs"
      onClick={props.onSave}
    >
      <FaSolidFloppyDisk />
      <span>{t("common.save")}</span>
    </button>
  </div>
);

export default GrantsRawMode;
