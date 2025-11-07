import { For, Show } from "solid-js";
import AppIcon from "./AppIcon";
import Clock from "./Clock";

interface AppInfo {
  id: string;
  name: string;
  icon?: string;
  isRunning: boolean;
}

interface DockProps {
  apps: AppInfo[];
  onAppClick: (appId: string) => void;
  onShowAllApps: () => void;
}

export default function Dock(props: DockProps) {
  const appsViewIcon =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%234a9eff'%3E%3Crect x='3' y='3' width='7' height='7' rx='1' fill='%234a9eff'/%3E%3Crect x='13' y='3' width='7' height='7' rx='1' fill='%234a9eff'/%3E%3Crect x='3' y='13' width='7' height='7' rx='1' fill='%234a9eff'/%3E%3Crect x='13' y='13' width='7' height='7' rx='1' fill='%234a9eff'/%3E%3C/svg%3E";

  return (
    <div class="dock">
      <div class="dock-left">
        <div class="app-icons">
          <For each={props.apps}>
            {(app) => (
              <AppIcon
                appId={app.id}
                appName={app.name}
                icon={app.icon}
                isRunning={app.isRunning}
                onClick={() => props.onAppClick(app.id)}
              />
            )}
          </For>
          <Show when={props.apps.some((app) => app.isRunning)}>
            <div class="separator"></div>
          </Show>
          <AppIcon
            appId="apps-view"
            appName="All Apps"
            icon={appsViewIcon}
            onClick={props.onShowAllApps}
          />
        </div>
      </div>
      <div class="dock-right">
        <Clock />
      </div>
    </div>
  );
}
