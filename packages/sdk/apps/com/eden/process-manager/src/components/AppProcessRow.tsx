import type { Component } from "solid-js";
import { For, Show } from "solid-js";
import { t } from "../i18n";
import {
  formatCpuUsage,
  formatMemoryUsage,
  getAppGroupKey,
  getAppSubtitle,
  getChildProcesses,
  getLocalizedManifestName,
  getProcessDisplayName,
} from "../process-metrics/model";
import type {
  AppIcons,
  ExpandedGroups,
  TrackedAppProcessMetrics,
} from "../process-metrics/types";

interface AppProcessRowProps {
  appIcons: AppIcons;
  appMetrics: TrackedAppProcessMetrics;
  expandedGroups: ExpandedGroups;
  onToggle: (appId: string) => void;
}

const AppProcessRow: Component<AppProcessRowProps> = (props) => {
  const children = () => getChildProcesses(props.appMetrics);
  const isExpandable = () => children().length > 1;
  const appGroupKey = () => getAppGroupKey(props.appMetrics);
  const isExpanded = () => props.expandedGroups[appGroupKey()];
  const primaryProcess = () => children()[0];
  const icon = () => props.appIcons[props.appMetrics.instance.manifest.id];

  return (
    <>
      <button
        type="button"
        class={`task-manager__row ${isExpandable() ? "task-manager__row--button" : ""}`}
        onClick={() => {
          if (!isExpandable()) return;
          props.onToggle(appGroupKey());
        }}
        disabled={!isExpandable()}
      >
        <div class="task-manager__cell task-manager__cell--name">
          <div class="task-manager__name-wrap">
            <Show
              when={isExpandable()}
              fallback={
                <span class="task-manager__toggle-spacer" aria-hidden="true" />
              }
            >
              <span
                class={`task-manager__toggle ${isExpanded() ? "task-manager__toggle--open" : ""}`}
                aria-hidden="true"
              />
            </Show>

            <div class="task-manager__process-icon">
              <Show
                when={icon()}
                fallback={<span class="task-manager__process-icon-fallback" />}
              >
                {(iconSrc) => <img src={iconSrc()} alt="" draggable={false} />}
              </Show>
            </div>

            <div class="task-manager__name-block">
              <div class="task-manager__name">
                <span class="task-manager__name-text">
                  {getLocalizedManifestName(
                    props.appMetrics.instance.manifest.name,
                  )}
                </span>
              </div>
              <div class="task-manager__subtext">
                {getAppSubtitle(props.appMetrics, children())}
              </div>
            </div>
          </div>
        </div>

        <div class="task-manager__cell task-manager__cell--pid">
          {isExpandable()
            ? t("taskManager.labels.groupedPid")
            : (primaryProcess()?.pid ?? t("taskManager.labels.groupedPid"))}
        </div>
        <div class="task-manager__cell task-manager__cell--numeric">
          {formatCpuUsage(props.appMetrics.totalCPUPercent)}
        </div>
        <div class="task-manager__cell task-manager__cell--numeric">
          {formatMemoryUsage(props.appMetrics.totalMemoryWorkingSetSize)}
        </div>
      </button>

      <Show when={isExpandable() && isExpanded()}>
        <For each={children()}>
          {(process) => (
            <div class="task-manager__row task-manager__row--child">
              <div class="task-manager__cell task-manager__cell--name">
                <div class="task-manager__name-wrap">
                  <span
                    class="task-manager__toggle-spacer"
                    aria-hidden="true"
                  />
                  <div class="task-manager__name-block">
                    <div class="task-manager__name">
                      <span class="task-manager__name-text">
                        {getProcessDisplayName(process)}
                      </span>
                    </div>
                    <div class="task-manager__subtext">{process.appId}</div>
                  </div>
                </div>
              </div>

              <div class="task-manager__cell task-manager__cell--pid">
                {process.pid}
              </div>
              <div class="task-manager__cell task-manager__cell--numeric">
                {formatCpuUsage(process.cpu.percentCPUUsage)}
              </div>
              <div class="task-manager__cell task-manager__cell--numeric">
                {formatMemoryUsage(process.memory.workingSetSize)}
              </div>
            </div>
          )}
        </For>
      </Show>
    </>
  );
};

export default AppProcessRow;
