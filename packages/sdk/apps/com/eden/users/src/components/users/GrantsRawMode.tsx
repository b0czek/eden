import { Alert, Button, TextField } from "@edenapp/solid-kit";
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
    <Alert tone="warning">
      <span class="eden-text-sm">{t("settings.users.rawWarning")}</span>
    </Alert>
    <TextField>
      <TextField.TextArea
        class="eden-font-mono eden-scrollbar raw-grants-textarea"
        aria-label={t("settings.users.grants")}
        value={props.rawGrantText()}
        onInput={(e) => props.onTextChange(e.currentTarget.value)}
      />
    </TextField>
    <Button
      variant="primary"
      class="eden-self-start eden-flex eden-items-center eden-gap-xs"
      onClick={props.onSave}
    >
      <FaSolidFloppyDisk />
      <span>{t("common.save")}</span>
    </Button>
  </div>
);

export default GrantsRawMode;
