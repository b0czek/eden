import { Show } from "solid-js";
import type { UserProfile } from "@edenapp/types";
import { t } from "../i18n";

interface UserBadgeProps {
  user: UserProfile | null;
  onClick: (event: MouseEvent) => void;
}

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  const initials = parts.map((part) => part[0]).join("");
  return initials.slice(0, 2).toUpperCase();
};

export default function UserBadge(props: UserBadgeProps) {
  return (
    <button type="button" class="user-badge" onClick={props.onClick}>
      <div class="eden-avatar eden-avatar-md">
        {props.user ? getInitials(props.user.name) : "?"}
      </div>
      <span class="user-badge-name">
        <Show when={props.user} fallback={t("shell.signIn")}>
          {props.user?.name}
        </Show>
      </span>
    </button>
  );
}
