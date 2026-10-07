import { createResource, Show } from "solid-js";
import { fetchAppIcon } from "../icon-cache";
import { t } from "../i18n";

interface AppIconProps {
  appId: string;
  appName: string;
  /** Optional direct icon data URL (for built-in icons that don't need fetching) */
  icon?: string;
  isRunning?: boolean;
  activity?: "launch" | "stop";
  onClick?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
}

export default function AppIcon(props: AppIconProps) {
  // Only fetch if no direct icon prop was provided
  const [fetchedIcon] = createResource(
    () => (props.icon ? null : props.appId),
    (appId) => (appId ? fetchAppIcon(appId) : Promise.resolve(undefined)),
  );

  const iconSrc = () => props.icon || fetchedIcon();

  const iconContent = (
    <>
      <div class="icon-container">
        <img src={iconSrc()} alt={props.appName} draggable={false} />
        <Show when={props.activity}>
          <span
            class="app-operation-indicator eden-spinner eden-spinner-sm"
            aria-hidden="true"
          />
        </Show>
        <Show when={props.isRunning && !props.activity}>
          <div class="running-indicator"></div>
        </Show>
      </div>
      <div class="app-name">{props.appName}</div>
    </>
  );

  return (
    <Show
      when={props.onClick || props.onContextMenu}
      fallback={
        <div class="app-icon" title={props.appName}>
          {iconContent}
        </div>
      }
    >
      <button
        type="button"
        class="app-icon"
        classList={{ running: props.isRunning }}
        onClick={props.onClick}
        onContextMenu={props.onContextMenu}
        title={props.appName}
        disabled={Boolean(props.activity)}
        aria-busy={Boolean(props.activity)}
        aria-label={
          props.activity === "launch"
            ? t("shell.launchingApp", { name: props.appName })
            : props.activity === "stop"
              ? t("shell.stoppingApp", { name: props.appName })
              : props.appName
        }
      >
        {iconContent}
      </button>
    </Show>
  );
}
