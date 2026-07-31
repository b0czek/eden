import type {
  DaemonDefinition,
  DaemonStatus,
  SettingsPanelValue,
  UserProfile,
} from "@edenapp/types";
import { FiCpu, FiPlay, FiRefreshCw, FiSquare } from "solid-icons/fi";
import type { Accessor } from "solid-js";
import { createMemo, createSignal, For, Show } from "solid-js";
import { getLocalizedValue, locale, t } from "../../i18n";
import type { LoadedPanel, PanelAction } from "../../types";
import "./DaemonsTab.css";

interface DaemonsPanelData {
  statuses: DaemonStatus[];
  users: UserProfile[];
}

export default function DaemonsTab(props: {
  panel: LoadedPanel;
  busyActions: Accessor<Set<string>>;
  onAction: PanelAction;
}) {
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const data = () => props.panel.state.data as unknown as DaemonsPanelData;
  const selected = createMemo(
    () =>
      data()?.statuses.find((status) => status.appId === selectedId()) ??
      data()?.statuses[0] ??
      null,
  );
  const busy = () => props.busyActions().size > 0;
  const run = (actionId: string, input: SettingsPanelValue) =>
    props.onAction(actionId, input);
  const update = (definition: DaemonDefinition) =>
    run("update-definition", {
      definition,
    } as unknown as SettingsPanelValue);

  return (
    <div class="daemon-management">
      <div class="eden-text-sm eden-text-muted">
        {t("settings.daemons.bootHint")}
      </div>
      <Show
        when={(data()?.statuses.length ?? 0) > 0}
        fallback={<div class="empty-state">{t("settings.daemons.empty")}</div>}
      >
        <div class="daemon-layout">
          <div class="eden-list daemon-list">
            <For each={data().statuses}>
              {(status) => (
                <button
                  type="button"
                  class={`eden-list-item eden-list-item-interactive ${
                    selected()?.appId === status.appId
                      ? "eden-list-item-active"
                      : ""
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
                        void run(
                          event.currentTarget.checked ? "enable" : "disable",
                          { appId: status().appId },
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
                      value={status().definition.runAs?.username ?? ""}
                      onChange={(event) =>
                        void update({
                          ...status().definition,
                          runAs: {
                            kind: "user",
                            username: event.currentTarget.value,
                          },
                        })
                      }
                    >
                      <option value="" disabled>
                        {t("settings.daemons.selectAccount")}
                      </option>
                      <For each={data().users}>
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
                        void update({
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
                        void run("start", { appId: status().appId })
                      }
                    >
                      <FiPlay /> {t("settings.daemons.start")}
                    </button>
                    <button
                      type="button"
                      class="eden-btn eden-btn-danger"
                      disabled={busy() || status().state === "inactive"}
                      onClick={() =>
                        void run("stop", { appId: status().appId })
                      }
                    >
                      <FiSquare /> {t("settings.daemons.stop")}
                    </button>
                    <button
                      type="button"
                      class="eden-btn eden-btn-secondary"
                      disabled={busy()}
                      onClick={() =>
                        void run("restart", { appId: status().appId })
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
