import { button, type Menu, menu, title, when } from "@edenapp/tablets";
import { t } from "./i18n";
import type { AppInfo } from "./types";

// ============================================================================
// App Context Menu
// ============================================================================

export interface AppMenuActions {
  open: (appId: string) => void | Promise<void>;
  stop: (appId: string) => void | Promise<void>;
  addToDock: (appId: string) => void | Promise<void>;
  removeFromDock: (appId: string) => void | Promise<void>;
  isPinned: (appId: string) => boolean;
}

export const createAppMenu = (actions: AppMenuActions): Menu<AppInfo> =>
  menu((app: AppInfo) => {
    const pinned = actions.isPinned(app.id);
    return [
      title(app.name),
      when(
        app.isRunning,
        button("stop", t("shell.stopApp"), () => actions.stop(app.id), {
          icon: "stop-circle",
        }),
        button("open", t("shell.openApp"), () => actions.open(app.id), {
          icon: "play",
        }),
      ),
      button(
        "dock",
        pinned ? t("shell.removeFromDock") : t("shell.addToDock"),
        () => (pinned ? actions.removeFromDock : actions.addToDock)(app.id),
        { icon: pinned ? "bookmark" : "plus" },
      ),
    ];
  });

// ============================================================================
// User Context Menu
// ============================================================================

export interface UserContextMenuActions {
  changePassword: () => Promise<void> | void;
  logout: () => Promise<void> | void;
}

export const createUserContextMenu = (
  actions: UserContextMenuActions,
): Menu<{ name: string } | null> =>
  menu((user: { name: string } | null) => [
    title(user?.name ?? t("shell.signIn")),
    user &&
      button(
        "changePassword",
        t("shell.changePassword"),
        actions.changePassword,
        { icon: "key" },
      ),
    user &&
      button("logout", t("shell.logout"), actions.logout, {
        icon: "log-out",
        danger: true,
      }),
  ]);
