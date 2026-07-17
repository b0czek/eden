import { Avatar, Badge, Button, List } from "@edenapp/solid-kit";
import type { UserProfile } from "@edenapp/types";
import { FiChevronRight, FiPlus } from "solid-icons/fi";
import { For, Show } from "solid-js";
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
      <Button
        variant="ghost"
        size="sm"
        onClick={props.onCreate}
        aria-label={t("settings.users.addUser")}
        title={t("settings.users.addUser")}
      >
        <FiPlus />
      </Button>
    </div>

    <List>
      <For each={props.users}>
        {(user) => (
          <List.Item
            as="button"
            type="button"
            interactive
            onClick={() => props.onSelect(user.username)}
          >
            <Avatar size="md">{getInitials(user.name)}</Avatar>

            <List.Content>
              <List.Title>{user.name}</List.Title>
              <List.Description>{user.role}</List.Description>
            </List.Content>

            <Show when={props.currentUser?.username === user.username}>
              <Badge size="sm" variant="primary">
                {t("settings.users.current")}
              </Badge>
            </Show>

            <Show when={props.defaultUsername === user.username}>
              <Badge size="sm" variant="secondary">
                {t("settings.users.autoLogin")}
              </Badge>
            </Show>

            <List.Meta>
              <FiChevronRight />
            </List.Meta>
          </List.Item>
        )}
      </For>
    </List>
  </>
);

export default UsersList;
