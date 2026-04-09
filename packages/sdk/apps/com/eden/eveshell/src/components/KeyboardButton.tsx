import { BiSolidKeyboard } from "solid-icons/bi";
import { t } from "../i18n";

interface KeyboardButtonProps {
  active: boolean;
  onClick: () => void | Promise<void>;
}

export default function KeyboardButton(props: KeyboardButtonProps) {
  const label = () => t("shell.toggleKeyboard");

  return (
    <button
      type="button"
      class="eden-btn eden-btn-ghost eden-btn-icon shell-keyboard-button"
      classList={{ active: props.active }}
      onClick={() => void props.onClick()}
      title={label()}
      aria-label={label()}
    >
      <BiSolidKeyboard />
    </button>
  );
}
