import type {
  DaemonDefinition,
  DaemonStatus,
  UserProfile,
} from "@edenapp/types";
import { FiCpu, FiPlay, FiRefreshCw, FiSquare } from "solid-icons/fi";
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { getLocalizedValue, locale, t } from "../../i18n";
import "./DaemonsTab.css";

export default function DaemonsTab() {
  const [statuses, setStatuses] = createSignal<DaemonStatus[]>([]);
  const [users, setUsers] = createSignal<UserProfile[]>([]);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const selected = createMemo(
    () => statuses().find((status) => status.appId === selectedId()) ?? null,
  );

  const load = async () => {
    try {
      const [daemonResult, userResult] = await Promise.all([
        window.edenAPI.shellCommand("daemon/list", {}),
        window.edenAPI.shellCommand("user/list", {}),
      ]);
      setStatuses(daemonResult);
      setUsers(userResult.users);
      if (!selectedId() && daemonResult[0])
        setSelectedId(daemonResult[0].appId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  onMount(async () => {
    await load();
    const refresh = () => void load();
    await window.edenAPI.subscribe("daemon/changed", refresh);
    onCleanup(() => {
      void window.edenAPI.unsubscribe("daemon/changed", refresh);
    });
  });

  const run = async (
    command:
      | "daemon/enable"
      | "daemon/disable"
      | "daemon/start"
      | "daemon/stop"
      | "daemon/restart"
      | "daemon/update-definition",
    args: Record<string, unknown>,
  ): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await window.edenAPI.shellCommand(command, args as never);
      await load();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await load();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const update = (definition: DaemonDefinition) =>
    run("daemon/update-definition", { definition });

  const updateRunAs = async (definition: DaemonDefinition) => {
    setStatuses((current) =>
      current.map((status) =>
        status.appId === definition.appId ? { ...status, definition } : status,
      ),
    );
    await run("daemon/update-definition", { definition });
  };

  const runAsValue = (definition: DaemonDefinition) =>
    definition.runAs?.username ?? "";

  return (
    <div class="daemon-management">
      <div class="eden-text-sm eden-text-muted">
        {t("settings.daemons.bootHint")}
      </div>

      <Show when={error()}>
        {(message) => <div class="daemon-error">{message()}</div>}
      </Show>

      <Show
        when={statuses().length > 0}
        fallback={<div class="empty-state">{t("settings.daemons.empty")}</div>}
      >
        <div class="daemon-layout">
          <div class="eden-list daemon-list">
            <For each={statuses()}>
              {(status) => (
                <button
                  type="button"
                  class={`eden-list-item eden-list-item-interactive ${
                    selectedId() === status.appId ? "eden-list-item-active" : ""
                  }`}
                  onClick={() => setSelectedId(status.appId)}
                >
                  <div class="eden-list-item-icon">
                    <FiCpu />
                  </div>
                  <div class="eden-list-item-content">
                    <div class="eden-list-item-title">
                      {getLocalizedValue(status.name, locale())}
                    </div>
                    <div class="eden-list-item-description">{status.appId}</div>
                  </div>
                  <span
                    class={`eden-badge daemon-state daemon-state-${status.state}`}
                  >
                    {status.state}
                  </span>
                </button>
              )}
            </For>
          </div>

          <Show when={selected()}>
            {(status) => (
              <div class="eden-card eden-card-glass daemon-detail">
                <div class="eden-card-header eden-flex-between">
                  <div>
                    <h3 class="eden-card-title">
                      {getLocalizedValue(status().name, locale())}
                    </h3>
                    <div class="eden-card-subtitle">{status().appId}</div>
                  </div>
                  <Show when={status().restartRequired}>
                    <span class="eden-badge eden-badge-warning">
                      {t("settings.daemons.restartRequired")}
                    </span>
                  </Show>
                </div>

                <div class="eden-card-body eden-flex-col eden-gap-lg">
                  <label class="eden-flex-between eden-gap-md">
                    <div>
                      <div class="eden-font-medium">
                        {t("settings.daemons.enabled")}
                      </div>
                      <div class="eden-text-sm eden-text-muted">
                        {t("settings.daemons.enabledHint")}
                      </div>
                    </div>
                    <input
                      class="eden-toggle"
                      type="checkbox"
                      checked={status().definition.enabled}
                      disabled={busy() || !status().definition.runAs}
                      onChange={(event) =>
                        run(
                          event.currentTarget.checked
                            ? "daemon/enable"
                            : "daemon/disable",
                          {
                            appId: status().appId,
                          },
                        )
                      }
                    />
                  </label>

                  <div class="eden-form-group">
                    <label class="eden-form-label" for="daemon-user">
                      {t("settings.daemons.runAs")}
                    </label>
                    <select
                      id="daemon-user"
                      class="eden-select"
                      disabled={busy()}
                      value={runAsValue(status().definition)}
                      onChange={(event) => {
                        const username = event.currentTarget.value;
                        if (!username) return;
                        updateRunAs({
                          ...status().definition,
                          runAs: { kind: "user", username },
                        });
                      }}
                    >
                      <option value="" disabled>
                        {t("settings.daemons.selectAccount")}
                      </option>
                      <For each={users()}>
                        {(user) => (
                          <option value={user.username}>{user.name}</option>
                        )}
                      </For>
                    </select>
                  </div>

                  <div class="eden-form-group">
                    <label class="eden-form-label" for="daemon-restart-policy">
                      {t("settings.daemons.restartPolicy")}
                    </label>
                    <select
                      id="daemon-restart-policy"
                      class="eden-select"
                      disabled={busy()}
                      value={status().definition.restart}
                      onChange={(event) =>
                        update({
                          ...status().definition,
                          restart: event.currentTarget
                            .value as DaemonDefinition["restart"],
                        })
                      }
                    >
                      <option value="never">
                        {t("settings.daemons.never")}
                      </option>
                      <option value="on-failure">
                        {t("settings.daemons.onFailure")}
                      </option>
                      <option value="always">
                        {t("settings.daemons.always")}
                      </option>
                    </select>
                  </div>

                  <Show when={status().lastError}>
                    {(message) => <div class="daemon-error">{message()}</div>}
                  </Show>

                  <div class="eden-flex eden-gap-sm">
                    <button
                      type="button"
                      class="eden-btn eden-btn-success"
                      disabled={
                        busy() ||
                        !status().definition.runAs ||
                        status().state === "active"
                      }
                      onClick={() =>
                        run("daemon/start", { appId: status().appId })
                      }
                    >
                      <FiPlay /> {t("settings.daemons.start")}
                    </button>
                    <button
                      type="button"
                      class="eden-btn eden-btn-danger"
                      disabled={busy() || status().state === "inactive"}
                      onClick={() =>
                        run("daemon/stop", { appId: status().appId })
                      }
                    >
                      <FiSquare /> {t("settings.daemons.stop")}
                    </button>
                    <button
                      type="button"
                      class="eden-btn eden-btn-secondary"
                      disabled={busy()}
                      onClick={() =>
                        run("daemon/restart", { appId: status().appId })
                      }
                    >
                      <FiRefreshCw /> {t("settings.daemons.restart")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}
