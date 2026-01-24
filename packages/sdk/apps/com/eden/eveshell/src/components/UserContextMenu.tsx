import type { UserProfile } from "@edenapp/types";
import { FiLogOut } from "solid-icons/fi";
import { t } from "../i18n";
import { ContextMenuPosition } from "../types";

interface UserContextMenuProps extends ContextMenuPosition {
  user: UserProfile;
  onLogout: () => Promise<void> | void;
  onClose: () => void;
}

export default function UserContextMenu(props: UserContextMenuProps) {
  const handleLogout = async () => {
    await props.onLogout();
    props.onClose();
  };

  return (
    <>
      <div
        class="eden-modal-overlay context-menu-overlay"
        onClick={props.onClose}
      />
      <div
        class="eden-popover"
        style={{
          ...(props.left !== undefined && { left: `${props.left}px` }),
          ...(props.right !== undefined && { right: `${props.right}px` }),
          ...(props.top !== undefined && { top: `${props.top}px` }),
          ...(props.bottom !== undefined && { bottom: `${props.bottom}px` }),
        }}
      >
        <div class="eden-popover-title context-menu-title">
          {props.user.name}
        </div>
        <button
          type="button"
          class="eden-btn eden-btn-ghost eden-btn-sm eden-btn-danger context-menu-btn"
          onClick={handleLogout}
        >
          <FiLogOut />
          {t("shell.logout")}
        </button>
      </div>
    </>
  );
}
