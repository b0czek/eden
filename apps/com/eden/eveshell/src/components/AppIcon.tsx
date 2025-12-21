import { Show, createResource } from "solid-js";
import { fetchAppIcon } from "../icon-cache";
import defaultIcon from "../../assets/default-icon.svg";

interface AppIconProps {
  appId: string;
  appName: string;
  /** Optional direct icon data URL (for built-in icons that don't need fetching) */
  icon?: string;
  isRunning?: boolean;
  onClick?: () => void;
}

export default function AppIcon(props: AppIconProps) {
  // Only fetch if no direct icon prop was provided
  const [fetchedIcon] = createResource(
    () => (props.icon ? null : props.appId),
    (appId) => (appId ? fetchAppIcon(appId) : Promise.resolve(undefined))
  );

  const iconSrc = () => props.icon || fetchedIcon() || defaultIcon;

  return (
    <div class="app-icon" onClick={props.onClick} title={props.appName}>
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
