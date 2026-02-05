import type { Menu } from "@edenapp/tablets";
import type { UserProfile } from "@edenapp/types";
import { createSignal, For, onMount, Show } from "solid-js";
import appsViewIcon from "../../assets/apps-grid-icon.svg";
import { t } from "../i18n";
import type { AppInfo } from "../types";
import AppIcon from "./AppIcon";
import Clock from "./Clock";
import UserBadge from "./UserBadge";

interface DockProps {
  runningApps: AppInfo[]; // Running apps that are NOT pinned
  pinnedApps: AppInfo[]; // Pinned apps (may or may not be running)
  currentUser: UserProfile | null;
  onAppClick: (appId: string) => void;
  onShowAllApps: () => void;
  userMenu: Menu<UserProfile | null>;
  appMenu: Menu<AppInfo>;
}

export default function Dock(props: DockProps) {
  let containerRef: HTMLDivElement | undefined;
  let dockRef: HTMLDivElement | undefined;
  const [isInitial, setIsInitial] = createSignal(true);

  onMount(() => {
    // Remove the initial class after animation completes
    setTimeout(() => {
      setIsInitial(false);
    }, 300); // Match animation duration
  });

  function handleMouseMove(e: MouseEvent) {
    if (!containerRef) return;
    const mouseX = e.clientX;

    const sigma = 70; // cursor influence radius (px)
    const maxScale = 1.25; // maximum magnification

    containerRef.classList.add("magnify-active");

    const icons = containerRef.querySelectorAll<HTMLDivElement>(".app-icon");
    icons.forEach((icon) => {
      const iconBox = icon.querySelector<HTMLDivElement>(".icon-container");
      if (!iconBox) return;
      const rect = icon.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const d = Math.abs(mouseX - centerX);
      const influence = Math.exp(-(d * d) / (2 * sigma * sigma)); // gaussian falloff
      const scale = 1 + (maxScale - 1) * influence;
      // pass influence to CSS var; lift entire tile and scale just the icon
      icon.style.setProperty("--influence", influence.toFixed(3));
      const lift = -8 * influence;
      icon.style.transform = `translateY(${lift.toFixed(1)}px)`;
      icon.style.zIndex = `${Math.round(scale * 100)}`; // larger sits above
      iconBox.style.transform = `scale(${scale.toFixed(3)})`;
    });
  }

  function handleMouseLeave() {
    if (!containerRef) return;
    containerRef.classList.remove("magnify-active");
    const appIcons = containerRef.querySelectorAll<HTMLDivElement>(".app-icon");
    appIcons.forEach((icon) => {
      const iconBox = icon.querySelector<HTMLDivElement>(".icon-container");
      if (iconBox) {
        iconBox.style.transform = "";
      }
      icon.style.transform = "";
      icon.style.zIndex = "";
    });
  }

  return (
    <div class="dock" classList={{ "dock-initial": isInitial() }} ref={dockRef}>
      <div class="dock-left">
        <div class="dock-user">
          <UserBadge
            user={props.currentUser}
            onClick={props.userMenu.handler(() => props.currentUser)}
          />
        </div>
      </div>
      <div class="dock-center">
        <div
          class="app-icons magnify"
          ref={containerRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {/* Running apps (not pinned) */}
          <For each={props.runningApps}>
            {(app) => (
              <AppIcon
                appId={app.id}
                appName={app.name}
                isRunning={app.isRunning}
                onClick={() => props.onAppClick(app.id)}
                onContextMenu={props.appMenu.handler(app)}
              />
            )}
          </For>

          {/* Separator between running and pinned */}
          <Show
            when={props.runningApps.length > 0 && props.pinnedApps.length > 0}
          >
            <div class="separator"></div>
          </Show>

          {/* Pinned apps */}
          <For each={props.pinnedApps}>
            {(app) => (
              <AppIcon
                appId={app.id}
                appName={app.name}
                isRunning={app.isRunning}
                onClick={() => props.onAppClick(app.id)}
                onContextMenu={props.appMenu.handler(app)}
              />
            )}
          </For>

          {/* Separator before All Apps button */}
          <Show
            when={props.runningApps.length > 0 || props.pinnedApps.length > 0}
          >
            <div class="separator"></div>
          </Show>

          <AppIcon
            appId="apps-view"
            appName={t("shell.allApps")}
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
