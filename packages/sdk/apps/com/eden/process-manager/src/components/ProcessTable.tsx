import type { Component } from "solid-js";
import { For, Show } from "solid-js";
import type { Store } from "solid-js/store";
import { t } from "../i18n";
import { formatCpuUsage, formatMemoryUsage } from "../process-metrics/model";
import type {
  AppIcons,
  ExpandedGroups,
  ProcessMetricsState,
} from "../process-metrics/types";
import AppProcessRow from "./AppProcessRow";
import SharedProcessRow from "./SharedProcessRow";

interface ProcessTableProps {
  appIcons: AppIcons;
  expandedGroups: ExpandedGroups;
  onToggleAppGroup: (appId: string) => void;
  snapshot: Store<ProcessMetricsState>;
}

const ProcessTable: Component<ProcessTableProps> = (props) => (
  <div class="task-manager__table eden-scrollbar">
    <div class="task-manager__header">
      <div>{t("taskManager.columns.name")}</div>
      <div class="task-manager__column--pid">
        {t("taskManager.columns.pid")}
      </div>
      <div class="task-manager__cell--numeric">
        {t("taskManager.columns.cpu")}
      </div>
      <div class="task-manager__cell--numeric">
        {t("taskManager.columns.memory")}
      </div>
    </div>

    <section class="task-manager__section">
      <div class="task-manager__section-header">
        <div class="task-manager__section-cell task-manager__section-cell--name">
          <p class="task-manager__section-title">
            {t("taskManager.sections.apps")}
          </p>
          <p class="task-manager__section-hint">
            {t("taskManager.labels.appsSectionHint")}
          </p>
        </div>
        <div class="task-manager__section-cell task-manager__section-cell--pid" />
        <div class="task-manager__section-cell task-manager__section-cell--numeric">
          {formatCpuUsage(props.snapshot.totals.appCPUPercent)}
        </div>
        <div class="task-manager__section-cell task-manager__section-cell--numeric">
          {formatMemoryUsage(props.snapshot.totals.appMemoryWorkingSetSize)}
        </div>
      </div>

      <div class="task-manager__rows">
        <Show
          when={props.snapshot.apps.length > 0}
          fallback={
            <div class="task-manager__empty">
              {t("taskManager.labels.noApps")}
            </div>
          }
        >
          <For each={props.snapshot.apps}>
            {(appMetrics) => (
              <AppProcessRow
                appIcons={props.appIcons}
                appMetrics={appMetrics}
                expandedGroups={props.expandedGroups}
                onToggle={props.onToggleAppGroup}
              />
            )}
          </For>
        </Show>
      </div>
    </section>

    <section class="task-manager__section">
      <div class="task-manager__section-header">
        <div class="task-manager__section-cell task-manager__section-cell--name">
          <p class="task-manager__section-title">
            {t("taskManager.sections.system")}
          </p>
          <p class="task-manager__section-hint">
            {t("taskManager.labels.systemSectionHint")}
          </p>
        </div>
        <div class="task-manager__section-cell task-manager__section-cell--pid" />
        <div class="task-manager__section-cell task-manager__section-cell--numeric">
          {formatCpuUsage(props.snapshot.totals.sharedCPUPercent)}
        </div>
        <div class="task-manager__section-cell task-manager__section-cell--numeric">
          {formatMemoryUsage(props.snapshot.totals.sharedMemoryWorkingSetSize)}
        </div>
      </div>

      <div class="task-manager__rows">
        <Show
          when={props.snapshot.sharedProcesses.length > 0}
          fallback={
            <div class="task-manager__empty">
              {t("taskManager.labels.noSystemProcesses")}
            </div>
          }
        >
          <For each={props.snapshot.sharedProcesses}>
            {(process) => <SharedProcessRow process={process} />}
          </For>
        </Show>
      </div>
    </section>
  </div>
);

export default ProcessTable;
