import type {
  AppManifest,
  RuntimeAppManifest,
  SettingsCategory,
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
import {
  isCustomViewCategory,
  resolveCategoryGrantTarget,
  resolveSettingGrantTarget,
} from "../../grants";
import { getLocalizedValue, locale, t } from "../../i18n";
import type { SettingsOption } from "./types";
import UserDetail from "./UserDetail";
import UsersList from "./UsersList";
import "./UsersTab.css";

interface UsersTabProps {
  edenSchema: () => SettingsCategory[];
  apps: () => AppManifest[];
}

export default function UsersTab(props: UsersTabProps) {
  const [users, setUsers] = createSignal<UserProfile[]>([]);
  const [currentUser, setCurrentUser] = createSignal<UserProfile | null>(null);
  const [defaultUsername, setDefaultUsername] = createSignal<string | null>(
    null,
  );
  const [installedApps, setInstalledApps] = createSignal<RuntimeAppManifest[]>(
    [],
  );
  const [selectedUsername, setSelectedUsername] = createSignal<string | null>(
    null,
  );
  const [showCreateDialog, setShowCreateDialog] = createSignal(false);
  const [passwordModalUser, setPasswordModalUser] =
    createSignal<UserProfile | null>(null);

  const loadUsers = async () => {
    try {
      const result = await window.edenAPI.shellCommand("user/list", {});
      setUsers(result.users ?? []);
    } catch (error) {
      console.error("Failed to load users:", error);
    }
  };

  const loadCurrentUser = async () => {
    try {
      const result = await window.edenAPI.shellCommand("user/get-current", {});
      setCurrentUser(result.user ?? null);
    } catch (error) {
      console.error("Failed to load current user:", error);
    }
  };

  const loadInstalledApps = async () => {
    try {
      const result = await window.edenAPI.shellCommand("package/list", {
        showHidden: true,
        showRestricted: true,
      });
      setInstalledApps(result);
    } catch (error) {
      console.error("Failed to load apps:", error);
    }
  };

  const loadDefaultUser = async () => {
    try {
      const result = await window.edenAPI.shellCommand("user/get-default", {});
      setDefaultUsername(result.username ?? null);
    } catch (error) {
      console.error("Failed to load default user:", error);
    }
  };

  const refreshAll = async () => {
    await Promise.all([
      loadUsers(),
      loadCurrentUser(),
      loadInstalledApps(),
      loadDefaultUser(),
    ]);
  };

  createEffect(() => {
    refreshAll();
  });

  onMount(() => {
    const handleInstalled = () => {
      loadInstalledApps();
    };
    const handleUninstalled = () => {
      loadInstalledApps();
    };

    const subscribe = async () => {
      try {
        await window.edenAPI.subscribe("package/installed", handleInstalled);
        await window.edenAPI.subscribe(
          "package/uninstalled",
          handleUninstalled,
        );
      } catch (error) {
        console.error("Failed to subscribe to package events:", error);
      }
    };

    subscribe();

    onCleanup(() => {
      window.edenAPI.unsubscribe("package/installed", handleInstalled);
      window.edenAPI.unsubscribe("package/uninstalled", handleUninstalled);
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

  const settingsOptions = createMemo<SettingsOption[]>(() => {
    const options: SettingsOption[] = [];
    const seen = new Set<string>();

    const pushOption = (appId: string, id: string, label: string) => {
      const key = `${appId}:${id}`;
      if (seen.has(key)) return;
      seen.add(key);
      options.push({ id, appId, label });
    };

    for (const category of props.edenSchema()) {
      const categoryGrant = resolveCategoryGrantTarget(category);
      if (categoryGrant) {
        pushOption(
          "com.eden",
          categoryGrant,
          getLocalizedValue(category.name, locale()),
        );
      }

      if (isCustomViewCategory(category)) {
        continue;
      }

      for (const setting of category.settings) {
        const grant = resolveSettingGrantTarget(category, setting);
        pushOption(
          "com.eden",
          grant,
          `${getLocalizedValue(category.name, locale())} · ${getLocalizedValue(
            setting.label,
            locale(),
          )}`,
        );
      }
    }

    for (const app of props.apps()) {
      if (!app.settings) continue;
      const appName = getLocalizedValue(app.name, locale());
      for (const category of app.settings) {
        for (const setting of category.settings) {
          options.push({
            id: setting.key,
            appId: app.id,
            label: `${appName} · ${getLocalizedValue(category.name, locale())} · ${getLocalizedValue(
              setting.label,
              locale(),
            )}`,
          });
        }
      }
    }

    return options;
  });

  const handleCreateUser = async (
    name: string,
    password: string,
  ): Promise<boolean> => {
    if (!name || !password) return false;
    try {
      const result = await window.edenAPI.shellCommand("user/create", {
        name,
        password,
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

  const handleDeleteUser = async (username: string) => {
    if (!confirm(t("settings.users.deleteConfirm"))) return;
    try {
      await window.edenAPI.shellCommand("user/delete", { username });
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
      await window.edenAPI.shellCommand("user/set-password", {
        username,
        password,
      });
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
      await window.edenAPI.shellCommand("user/update", {
        username,
        grants: Array.from(grants),
      });
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
      await window.edenAPI.shellCommand("user/set-default", {
        username: next,
      });
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
              installedApps={installedApps()}
              settingsOptions={settingsOptions()}
              isDefaultUser={defaultUsername() === user().username}
              onBack={() => setSelectedUsername(null)}
              onDelete={handleDeleteUser}
              onOpenPasswordModal={(target) => setPasswordModalUser(target)}
              onToggleDefaultUser={handleToggleDefaultUser}
              updateGrants={updateGrants}
            />
          )}
        </Show>
      </section>

      <CreateUserDialog
        show={showCreateDialog()}
        onClose={() => setShowCreateDialog(false)}
        onCreate={({ name, password }) => handleCreateUser(name, password)}
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
