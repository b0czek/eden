import type { Component } from "solid-js";

interface StatusBarProps {
  currentPath: string;
  itemCount: number;
}

const StatusBar: Component<StatusBarProps> = (props) => {
  return (
    <footer class="explorer-status">
      <div class="status-left">
        <span class="status-path">{props.currentPath}</span>
      </div>
      <div class="status-right">
        <span>{props.itemCount} items</span>
      </div>
    </footer>
  );
};

export default StatusBar;
