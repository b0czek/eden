import type { Component } from "solid-js";
import { Show } from "solid-js";
import "./App.css";
import ProcessTable from "./components/ProcessTable";
import { t } from "./i18n";
import { useProcessMetrics } from "./process-metrics/useProcessMetrics";

const App: Component = () => {
  const { appIcons, error, expandedGroups, snapshot, toggleAppGroup } =
    useProcessMetrics();

  return (
    <main class="task-manager">
      <Show when={error()}>
        <div class="task-manager__notice">
          <span class="task-manager__notice-title">{error()}</span>
          <span class="task-manager__notice-text">
            {t("taskManager.staleData")}
          </span>
        </div>
      </Show>

      <ProcessTable
        appIcons={appIcons()}
        expandedGroups={expandedGroups()}
        onToggleAppGroup={toggleAppGroup}
        snapshot={snapshot}
      />
    </main>
  );
};

export default App;
