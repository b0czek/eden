import { KeyboardButton } from "@edenapp/solid-kit";
import { createDialogs, DialogHost } from "@edenapp/solid-kit/dialogs";
import type {
  EdenBrandingInfo,
  EdenPowerCapabilities,
  UserProfile,
  ViewBounds,
  WindowSize,
} from "@edenapp/types";
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { initLocale, t } from "./i18n";

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  const initials = parts.map((part) => part[0]).join("");
  return initials.slice(0, 2).toUpperCase();
};

const App = () => {
  const dialogs = createDialogs();
  const [users, setUsers] = createSignal<UserProfile[]>([]);
  const [selectedUsername, setSelectedUsername] = createSignal<string | null>(
    null,
  );
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [submitting, setSubmitting] = createSignal(false);
  const [branding, setBranding] = createSignal<EdenBrandingInfo>({
    name: "Eden",
  });
  const [powerCapabilities, setPowerCapabilities] =
    createSignal<EdenPowerCapabilities>({ poweroff: false, reboot: false });

  const updateViewBounds = async (data: { windowSize: WindowSize }) => {
    const { windowSize } = data;
    const bounds: ViewBounds = {
      x: 0,
      y: 0,
      width: windowSize.width,
      height: windowSize.height,
    };
    try {
      await window.edenAPI.shellCommand("view/update-bounds", {
        bounds,
      });
    } catch (error) {
      console.error("Failed to update view bounds:", error);
    }
  };

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.edenAPI.shellCommand("user/list", {});
      setUsers(result.users ?? []);
    } catch (err) {
      console.error("Failed to load users:", err);
      setError(t("login.failedToLoadUsers"));
    } finally {
      setLoading(false);
    }
  };

  const loadBranding = async () => {
    try {
      setBranding(await window.edenAPI.shellCommand("system/branding", {}));
    } catch (error) {
      console.error("Failed to load product branding:", error);
    }
  };

  const loadPowerCapabilities = async () => {
    try {
      setPowerCapabilities(
        await window.edenAPI.shellCommand("system/power-capabilities", {}),
      );
    } catch (error) {
      console.error("Failed to load power capabilities:", error);
    }
  };

  onMount(() => {
    onCleanup(() => {
      window.edenAPI.unsubscribe(
        "view/global-bounds-changed",
        updateViewBounds,
      );
    });

    (async () => {
      await initLocale();
      await Promise.all([loadBranding(), loadUsers(), loadPowerCapabilities()]);

      // Set initial bounds
      try {
        const windowSize = await window.edenAPI.shellCommand(
          "view/window-size",
          {},
        );
        await updateViewBounds({ windowSize });
      } catch (error) {
        console.error("Failed to get initial window size:", error);
      }

      // Subscribe to resize events
      try {
        await window.edenAPI.subscribe(
          "view/global-bounds-changed",
          updateViewBounds,
        );
      } catch (error) {
        console.error("Failed to subscribe to bounds change:", error);
      }
    })();
  });

  createEffect(() => {
    if (selectedUsername()) return;
    const first = users()[0]?.username ?? null;
    setSelectedUsername(first);
  });

  const handleLogin = async () => {
    const username = selectedUsername();
    if (!username || !password() || submitting()) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await window.edenAPI.shellCommand("session/login", {
        username,
        password: password(),
      });
      if (!result.success) {
        setError(result.error ?? t("login.loginFailed"));
      } else {
        setPassword("");
      }
    } catch (err) {
      console.error("Login failed:", err);
      setError(t("login.loginFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handlePowerAction = async (action: "poweroff" | "reboot") => {
    const confirmed = await dialogs.confirm({
      title: action === "poweroff" ? t("login.poweroff") : t("login.reboot"),
      message:
        action === "poweroff"
          ? t("login.poweroffConfirmation")
          : t("login.rebootConfirmation"),
      confirmLabel:
        action === "poweroff" ? t("login.poweroff") : t("login.reboot"),
      cancelLabel: t("common.cancel"),
      tone: action === "poweroff" ? "danger" : "default",
      role: "alertdialog",
    });
    if (!confirmed) return;

    try {
      await window.edenAPI.shellCommand("system/power", { action });
    } catch (error) {
      console.error(`Failed to ${action} the system:`, error);
      await dialogs.alert({
        title: t("common.error"),
        message: t("login.powerActionFailed"),
        okLabel: t("common.ok"),
      });
    }
  };

  return (
    <div class="login-root eden-flex eden-flex-center">
      <div class="login-card eden-glass-strong eden-rounded-xl eden-p-lg">
        <div class="eden-flex eden-flex-col eden-gap-md">
          <Show when={branding().logoDataUrl}>
            {(logoDataUrl) => (
              <div class="login-brand eden-flex-center">
                <img
                  class="login-brand-logo"
                  src={logoDataUrl()}
                  alt={branding().name}
                />
              </div>
            )}
          </Show>

          <header class="login-header eden-flex eden-flex-between eden-gap-md">
            <div class="eden-flex eden-flex-col eden-gap-xs">
              <h2 class="eden-text-2xl eden-font-semibold">
                {t("login.signIn")}
              </h2>
              <p class="eden-text-sm eden-text-secondary">
                {t("login.subtitle")}
              </p>
            </div>
            <KeyboardButton label={t("login.toggleKeyboard")} />
          </header>

          <Show
            when={!loading()}
            fallback={
              <div class="eden-flex eden-flex-center eden-gap-sm">
                <div class="eden-loading-spinner"></div>
                <span class="eden-text-sm eden-text-secondary">
                  {t("login.loadingUsers")}
                </span>
              </div>
            }
          >
            <Show
              when={users().length > 0}
              fallback={
                <div class="eden-flex eden-flex-col eden-gap-sm">
                  <span class="eden-text-sm eden-text-secondary">
                    {t("login.noUsersAvailable")}
                  </span>
                  <button
                    type="button"
                    class="eden-btn eden-btn-secondary"
                    onClick={loadUsers}
                  >
                    {t("common.retry")}
                  </button>
                </div>
              }
            >
              <div class="eden-grid eden-grid-2 eden-gap-lg user-login-grid">
                <div class="eden-flex eden-flex-col eden-gap-sm">
                  <ul class="eden-list user-list">
                    <For each={users()}>
                      {(user) => (
                        <li
                          class="eden-list-item eden-list-item-interactive"
                          classList={{
                            "eden-list-item-active":
                              selectedUsername() === user.username,
                          }}
                          onClick={() => {
                            setSelectedUsername(user.username);
                            setError(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedUsername(user.username);
                              setError(null);
                            }
                          }}
                        >
                          <div class="eden-avatar eden-avatar-md">
                            {getInitials(user.name)}
                          </div>
                          <div class="eden-list-item-content">
                            <div class="eden-list-item-title">{user.name}</div>
                          </div>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>

                <div class="eden-flex eden-flex-col eden-gap-sm login-form-container">
                  <label
                    class="eden-text-sm eden-text-secondary"
                    for="password"
                  >
                    {t("common.password")}
                  </label>
                  <input
                    id="password"
                    class="eden-input"
                    type="password"
                    value={password()}
                    placeholder={t("login.enterPassword")}
                    onInput={(e) => setPassword(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleLogin();
                      }
                    }}
                  />
                  <Show when={error()}>
                    <div class="user-error eden-text-sm">{error()}</div>
                  </Show>
                  <button
                    type="button"
                    class="eden-btn eden-btn-primary"
                    onClick={handleLogin}
                    disabled={
                      submitting() || !password() || !selectedUsername()
                    }
                  >
                    {submitting() ? t("login.signingIn") : t("login.signIn")}
                  </button>
                </div>
              </div>
            </Show>
          </Show>
        </div>
      </div>

      <Show when={powerCapabilities().reboot || powerCapabilities().poweroff}>
        <div class="login-power-actions eden-flex eden-gap-sm">
          <Show when={powerCapabilities().reboot}>
            <button
              type="button"
              class="eden-btn eden-btn-secondary"
              onClick={() => handlePowerAction("reboot")}
            >
              {t("login.reboot")}
            </button>
          </Show>
          <Show when={powerCapabilities().poweroff}>
            <button
              type="button"
              class="eden-btn eden-btn-danger"
              onClick={() => handlePowerAction("poweroff")}
            >
              {t("login.poweroff")}
            </button>
          </Show>
        </div>
      </Show>

      <DialogHost dialogs={dialogs} />
    </div>
  );
};

export default App;
