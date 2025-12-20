import { Show, createResource } from "solid-js";
import { fetchAppIcon } from "../icon-cache";

interface AppIconProps {
  appId: string;
  appName: string;
  /** Optional direct icon data URL (for built-in icons that don't need fetching) */
  icon?: string;
  isRunning?: boolean;
  onClick?: () => void;
}

export default function AppIcon(props: AppIconProps) {
  const defaultIcon =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%234a9eff'%3E%3Crect x='3' y='3' width='18' height='18' rx='2' fill='%232d2d2d'/%3E%3Cpath d='M8 8h8v2H8V8zm0 3h8v2H8v-2zm0 3h5v2H8v-2z' fill='%234a9eff'/%3E%3C/svg%3E";

  // Only fetch if no direct icon prop was provided
  const [fetchedIcon] = createResource(
    () => props.icon ? null : props.appId,
    (appId) => appId ? fetchAppIcon(appId) : Promise.resolve(undefined)
  );

  const iconSrc = () => props.icon || fetchedIcon() || defaultIcon;

  return (
    <div
      class="app-icon"
      classList={{ running: props.isRunning }}
      onClick={props.onClick}
      title={props.appName}
    >
      <div class="icon-container">
        <img src={iconSrc()} alt={props.appName} />
        <Show when={props.isRunning}>
          <div class="running-indicator"></div>
        </Show>
      </div>
      <div class="app-name">{props.appName}</div>
    </div>
  );
}
