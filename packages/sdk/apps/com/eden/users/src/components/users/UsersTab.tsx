import * as eden from "@edenapp/client";
import type {
  UserGrantOption,
  UserGrantOptionsResponse,
  UserProfile,
} from "@edenapp/types";
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import CreateUserDialog from "../../dialogs/CreateUserDialog";
import SetPasswordDialog from "../../dialogs/SetPasswordDialog";
import { t } from "../../i18n";
import UserDetail from "./UserDetail";
import UsersList from "./UsersList";
import "./UsersTab.css";

export default function UsersTab() {
  const [users, setUsers] = createSignal<UserProfile[]>([]);
  const [currentUser, setCurrentUser] = createSignal<UserProfile | null>(null);
  const [defaultUsername, setDefaultUsername] = createSignal<string | null>(
    null,
  );
  const [grantOptions, setGrantOptions] = createSignal<UserGrantOption[]>([]);
  let grantOptionsRevision = 0;
  const [selectedUsername, setSelectedUsername] = createSignal<string | null>(
    null,
  );
  const [showCreateDialog, setShowCreateDialog] = createSignal(false);
  const [passwordModalUser, setPasswordModalUser] =
    createSignal<UserProfile | null>(null);

  const loadUsers = async () => {
    try {
      const result = await eden.user.list();
      setUsers(result.users ?? []);
    } catch (error) {
      console.error("Failed to load users:", error);
    }
  };

  const loadCurrentUser = async () => {
    try {
      const result = await eden.session.getCurrent();
      setCurrentUser(result.user ?? null);
    } catch (error) {
      console.error("Failed to load current user:", error);
    }
  };

  const loadGrantOptions = async () => {
    try {
      const result: UserGrantOptionsResponse = await eden.user.grantOptions();
      if (result.revision < grantOptionsRevision) return;
      grantOptionsRevision = result.revision;
      setGrantOptions(result.options);
    } catch (error) {
      console.error("Failed to load grant options:", error);
    }
  };

  const loadDefaultUser = async () => {
    try {
      const result = await eden.user.getDefault();
      setDefaultUsername(result.username ?? null);
    } catch (error) {
      console.error("Failed to load default user:", error);
    }
  };

  const refreshAll = async () => {
    await Promise.all([
      loadUsers(),
      loadCurrentUser(),
      loadGrantOptions(),
      loadDefaultUser(),
    ]);
  };

  createEffect(() => {
    refreshAll();
  });

  onMount(() => {
    const handleGrantOptionsChanged = () => loadGrantOptions();

    const subscribe = async () => {
      try {
        await eden.user.subscribe(
          "grant-options-changed",
          handleGrantOptionsChanged,
        );
      } catch (error) {
        console.error("Failed to subscribe to grant options:", error);
      }
    };

    subscribe();

    onCleanup(() => {
      eden.user.unsubscribe("grant-options-changed", handleGrantOptionsChanged);
    });
  });

  const sortedUsers = createMemo(() => {
    const list = [...users()];
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  });

  const selectedUser = createMemo(
    () => users().find((user) => user.username === selectedUsername()) ?? null,
  );

  createEffect(() => {
    const selected = selectedUsername();
    if (!selected) return;
    if (!users().some((user) => user.username === selected)) {
      setSelectedUsername(null);
    }
  });

  const handleCreateUser = async (
    name: string,
    password: string,
    directoryRestriction?: string,
  ): Promise<boolean> => {
    if (!name || !password) return false;
    try {
      const result = await eden.user.create(name, password, {
        directoryRestriction,
      });
      setShowCreateDialog(false);
      await loadUsers();
      if (result.user?.username) {
        setSelectedUsername(result.user.username);
      }
      return true;
    } catch (error) {
      console.error("Failed to create user:", error);
      return false;
    }
  };

  const handleDirectoryRestrictionSave = async (
    username: string,
    directoryRestriction: string,
  ): Promise<boolean> => {
    try {
      const result = await eden.user.update(username, {
        directoryRestriction: directoryRestriction.trim() || null,
      });
      setUsers((current) =>
        current.map((user) =>
          user.username === username ? result.user : user,
        ),
      );
      return true;
    } catch (error) {
      console.error("Failed to update folder restriction:", error);
      return false;
    }
  };

  const handleDeleteUser = async (username: string) => {
    if (!confirm(t("settings.users.deleteConfirm"))) return;
    try {
      await eden.user.delete(username);
      await loadUsers();
      if (selectedUsername() === username) {
        setSelectedUsername(null);
      }
    } catch (error) {
      console.error("Failed to delete user:", error);
    }
  };

  const handlePasswordSave = async (
    username: string,
    password: string,
  ): Promise<boolean> => {
    if (!password) return false;
    try {
      await eden.user.setPassword(username, password);
      return true;
    } catch (error) {
      console.error("Failed to set password:", error);
      return false;
    }
  };

  const updateGrants = async (
    username: string,
    updater: (grants: Set<string>) => Set<string>,
  ) => {
    const user = users().find((item) => item.username === username);
    if (!user) return;
    const grants = updater(new Set(user.grants ?? []));
    try {
      await eden.user.update(username, { grants: Array.from(grants) });
      await loadUsers();
    } catch (error) {
      console.error("Failed to update grants:", error);
    }
  };

  const handleToggleDefaultUser = async (
    username: string,
    enabled: boolean,
  ) => {
    try {
      const next = enabled ? username : null;
      await eden.user.setDefault(next);
      setDefaultUsername(next);
    } catch (error) {
      console.error("Failed to update default user:", error);
    }
  };

  return (
    <div class="users-tab eden-flex eden-flex-col eden-gap-lg eden-scrollbar">
      <section class="users-management eden-flex-col eden-gap-sm">
        <Show
          when={selectedUser()}
          fallback={
            <UsersList
              users={sortedUsers()}
              currentUser={currentUser()}
              defaultUsername={defaultUsername()}
              onSelect={(username) => setSelectedUsername(username)}
              onCreate={() => setShowCreateDialog(true)}
            />
          }
        >
          {(user) => (
            <UserDetail
              user={user()}
              currentUser={currentUser()}
              grantOptions={grantOptions()}
              isDefaultUser={defaultUsername() === user().username}
              onBack={() => setSelectedUsername(null)}
              onDelete={handleDeleteUser}
              onOpenPasswordModal={(target) => setPasswordModalUser(target)}
              onToggleDefaultUser={handleToggleDefaultUser}
              onSaveDirectoryRestriction={handleDirectoryRestrictionSave}
              updateGrants={updateGrants}
            />
          )}
        </Show>
      </section>

      <CreateUserDialog
        show={showCreateDialog()}
        onClose={() => setShowCreateDialog(false)}
        onCreate={({ name, password, directoryRestriction }) =>
          handleCreateUser(name, password, directoryRestriction)
        }
      />
      <SetPasswordDialog
        show={Boolean(passwordModalUser())}
        user={passwordModalUser()}
        onClose={() => setPasswordModalUser(null)}
        onSave={handlePasswordSave}
      />
    </div>
  );
}
