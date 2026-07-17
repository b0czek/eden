import { Badge, Button } from "@edenapp/solid-kit";
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
      <Button
        type="button"
        variant="ghost"
        class="eden-btn-icon"
        onClick={props.onBack}
        title={t("common.back")}
      >
        <FiArrowLeft />
      </Button>
      <div class="eden-flex eden-flex-col">
        <h3 class="eden-card-title">{props.user.name}</h3>
        <div class="eden-flex eden-gap-xs">
          <Badge size="sm">{props.user.role}</Badge>
          <Show when={props.isCurrent}>
            <Badge variant="secondary" size="sm">
              {t("settings.users.current")}
            </Badge>
          </Show>
        </div>
      </div>
    </div>

    <div class="eden-flex eden-gap-sm">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={props.onSetPassword}
      >
        {t("settings.users.setPassword")}
      </Button>
      <Show when={!props.isVendor}>
        <Button
          type="button"
          variant="danger"
          size="sm"
          class="eden-btn-icon"
          onClick={props.onDelete}
          title={t("settings.users.delete")}
        >
          <FaSolidTrash />
        </Button>
      </Show>
    </div>
  </div>
);

export default UserDetailHeader;
