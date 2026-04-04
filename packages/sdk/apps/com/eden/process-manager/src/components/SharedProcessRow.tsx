import type { Component } from "solid-js";
import {
  formatCpuUsage,
  formatMemoryUsage,
  getProcessDisplayName,
} from "../process-metrics/model";
import type { TrackedProcessMetric } from "../process-metrics/types";

interface SharedProcessRowProps {
  process: TrackedProcessMetric;
}

const SharedProcessRow: Component<SharedProcessRowProps> = (props) => (
  <div class="task-manager__row task-manager__row--shared">
    <div class="task-manager__cell task-manager__cell--name">
      <div class="task-manager__name-wrap">
        <span class="task-manager__toggle-spacer" aria-hidden="true" />
        <div class="task-manager__name-block">
          <div class="task-manager__name">
            <span class="task-manager__name-text">
              {getProcessDisplayName(props.process)}
            </span>
          </div>
          <div class="task-manager__subtext">
            {props.process.serviceName || props.process.processType}
          </div>
        </div>
      </div>
    </div>

    <div class="task-manager__cell task-manager__cell--pid">
      {props.process.pid}
    </div>
    <div class="task-manager__cell task-manager__cell--numeric">
      {formatCpuUsage(props.process.cpu.percentCPUUsage)}
    </div>
    <div class="task-manager__cell task-manager__cell--numeric">
      {formatMemoryUsage(props.process.memory.workingSetSize)}
    </div>
  </div>
);

export default SharedProcessRow;
