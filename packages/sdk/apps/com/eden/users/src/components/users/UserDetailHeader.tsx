import type { UserProfile } from "@edenapp/types";
import { FaSolidTrash } from "solid-icons/fa";
import { FiArrowLeft } from "solid-icons/fi";
import { Show } from "solid-js";
import { t } from "../../i18n";

interface UserDetailHeaderProps {
  user: UserProfile;
  isCurrent: boolean;
  isVendor: boolean;
  onBack: () => void;
  onDelete: () => void;
  onSetPassword: () => void;
}

const UserDetailHeader = (props: UserDetailHeaderProps) => (
  <div class="eden-card-header eden-flex eden-flex-between eden-items-center">
    <div class="eden-flex eden-items-center eden-gap-md">
      <button
        type="button"
        class="eden-btn eden-btn-ghost eden-btn-icon"
        onClick={props.onBack}
        title={t("common.back")}
      >
        <FiArrowLeft />
      </button>
      <div class="eden-flex eden-flex-col">
        <h3 class="eden-card-title">{props.user.name}</h3>
        <div class="eden-flex eden-gap-xs">
          <span class="eden-badge eden-badge-sm">{props.user.role}</span>
          <Show when={props.isCurrent}>
            <span class="eden-badge eden-badge-secondary eden-badge-sm">
              {t("settings.users.current")}
            </span>
          </Show>
        </div>
      </div>
    </div>

    <div class="eden-flex eden-gap-sm">
      <button
        type="button"
        class="eden-btn eden-btn-secondary eden-btn-sm"
        onClick={props.onSetPassword}
      >
        {t("settings.users.setPassword")}
      </button>
      <Show when={!props.isVendor}>
        <button
          type="button"
          class="eden-btn eden-btn-danger eden-btn-sm eden-btn-icon"
          onClick={props.onDelete}
          title={t("settings.users.delete")}
        >
          <FaSolidTrash />
        </button>
      </Show>
    </div>
  </div>
);

export default UserDetailHeader;
