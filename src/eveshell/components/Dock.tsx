import { For, Show, createSignal, onMount } from "solid-js";
import AppIcon from "./AppIcon";
import Clock from "./Clock";
import { AppInfo } from "../types";
import appsViewIcon from "../assets/apps-grid-icon.svg";

interface DockProps {
  apps: AppInfo[];
  onAppClick: (appId: string) => void;
  onShowAllApps: () => void;
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
    const bounds = containerRef.getBoundingClientRect();
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
        <div
          class="app-icons magnify"
          ref={containerRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <For each={props.apps}>
            {(app) => (
              <AppIcon
                appId={app.id}
                appName={app.name}
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
