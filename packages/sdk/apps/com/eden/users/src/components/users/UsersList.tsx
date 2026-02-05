import { For, Show } from "solid-js";
import type { UserProfile } from "@edenapp/types";
import { FiPlus, FiChevronRight } from "solid-icons/fi";
import { t } from "../../i18n";

interface UsersListProps {
  users: UserProfile[];
  currentUser: UserProfile | null;
  defaultUsername: string | null;
  onSelect: (username: string) => void;
  onCreate: () => void;
}

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  const initials = parts.map((part) => part[0]).join("");
  return initials.slice(0, 2).toUpperCase();
};

const UsersList = (props: UsersListProps) => (
  <>
    <div class="settings-section eden-flex eden-items-center eden-flex-between">
      <h2 class="settings-section-title">{t("settings.users.title")}</h2>
      <button
        type="button"
        class="eden-btn eden-btn-ghost eden-btn-sm"
        onClick={props.onCreate}
        aria-label={t("settings.users.addUser")}
        title={t("settings.users.addUser")}
      >
        <FiPlus />
      </button>
    </div>

    <div class="eden-list">
      <For each={props.users}>
        {(user) => (
          <div
            class="eden-list-item eden-list-item-interactive"
            onClick={() => props.onSelect(user.username)}
          >
            <div class="eden-avatar eden-avatar-md">
              {getInitials(user.name)}
            </div>

            <div class="eden-list-item-content">
              <div class="eden-list-item-title">{user.name}</div>
              <div class="eden-list-item-description">{user.role}</div>
            </div>

            <Show when={props.currentUser?.username === user.username}>
              <span class="eden-badge eden-badge-sm eden-badge-primary">
                {t("settings.users.current")}
              </span>
            </Show>

            <Show when={props.defaultUsername === user.username}>
              <span class="eden-badge eden-badge-sm eden-badge-secondary">
                {t("settings.users.autoLogin")}
              </span>
            </Show>

            <div class="eden-list-item-meta">
              <FiChevronRight />
            </div>
          </div>
        )}
      </For>
    </div>
  </>
);

export default UsersList;
