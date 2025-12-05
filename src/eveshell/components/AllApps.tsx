import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import AppIcon from "./AppIcon";

interface AppItem {
	id: string;
	name: string;
	icon?: string;
	isRunning: boolean;
}

interface AllAppsProps {
	apps: AppItem[];
	runningApps: Set<string>;
	onClose: () => void;
	onInstall: () => void;
	onAppClick: (appId: string) => Promise<void> | void;
	onStopApp: (appId: string) => Promise<void> | void;
	onUninstallApp: (appId: string) => Promise<void> | void;
}

export default function AllApps(props: AllAppsProps) {
	const [contextMenu, setContextMenu] = createSignal<{
		appId: string;
		appName: string;
		isRunning: boolean;
		x: number;
		y: number;
	} | null>(null);
	const [hotReloadApps, setHotReloadApps] = createSignal<Set<string>>(new Set());
	const [longPressTimer, setLongPressTimer] = createSignal<number | null>(null);
	const [isClosing, setIsClosing] = createSignal(false);
	const EXIT_ANIMATION_MS = 280;
	let exitTimer: number | undefined;

	onMount(async () => {
		// Load hot reload status for all apps
		// TODO: Improve this
		const hotReloadSet = new Set<string>();
		for (const app of props.apps) {
			try {
				const result = await window.edenAPI.shellCommand("package/is-hot-reload-enabled", { appId: app.id });
				if (result.enabled) {
					hotReloadSet.add(app.id);
				}
			} catch (error) {
				console.error(`Failed to check hot reload status for ${app.id}:`, error);
			}
		}
		setHotReloadApps(hotReloadSet);
	});

	onCleanup(() => {
		const timer = longPressTimer();
		if (timer) {
			clearTimeout(timer);
		}
		if (exitTimer) {
			clearTimeout(exitTimer);
		}
	});

	function clearLongPressTimer() {
		const timer = longPressTimer();
		if (timer) {
			clearTimeout(timer);
			setLongPressTimer(null);
		}
	}

	function triggerClose() {
		if (isClosing()) return;
		setContextMenu(null);
		setIsClosing(true);
		exitTimer = window.setTimeout(() => {
			props.onClose();
			exitTimer = undefined;
		}, EXIT_ANIMATION_MS);
	}

	function handleOverlayClick() {
		if (isClosing()) return;
		triggerClose();
	}

	async function handleTileClick(appId: string) {
		// Close the view
		if (!isClosing()) {
			triggerClose();
		}

		// Reveal all running apps
		const running = props.runningApps;
		for (const runningAppId of running) {
			try {
				await window.edenAPI.shellCommand("view/set-view-visibility", {
					appId: runningAppId,
					visible: true,
				});
			} catch (error) {
				console.error(`Failed to set visibility for ${runningAppId}:`, error);
			}
		}

		// Launch or focus the selected app
		await props.onAppClick(appId);
	}

	function handleContextMenu(
		e: MouseEvent,
		appId: string,
		appName: string,
		isRunning: boolean
	) {
		if (isClosing()) return;
		e.preventDefault();
		e.stopPropagation();
		setContextMenu({
			appId,
			appName,
			isRunning,
			x: e.clientX,
			y: e.clientY,
		});
	}

	function handleLongPressStart(
		e: TouchEvent | MouseEvent,
		appId: string,
		appName: string,
		isRunning: boolean
	) {
		if (isClosing()) return;
		const timer = window.setTimeout(() => {
			const clientX = "touches" in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
			const clientY = "touches" in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
			setContextMenu({
				appId,
				appName,
				isRunning,
				x: clientX,
				y: clientY,
			});
		}, 500);
		setLongPressTimer(timer);
	}

	function handleLongPressEnd() {
		clearLongPressTimer();
	}

	return (
		<>
			<div
				class="eden-modal-overlay"
				classList={{ closing: isClosing() }}
				onClick={handleOverlayClick}
			>
				<div
					class="eden-modal eden-modal-lg"
					classList={{ closing: isClosing() }}
					onClick={(e) => e.stopPropagation()}
				>
					<div class="eden-modal-header">
						<h2 class="eden-modal-title">All Applications</h2>
						<div style="display: flex; gap: var(--eden-space-sm);">
							<button
								class="eden-btn eden-btn-square eden-btn-primary"
								aria-label="Install App"
								onClick={(e) => {
									e.stopPropagation();
									if (!isClosing()) {
										props.onInstall();
									}
								}}
							>
								+
							</button>
							<button
								class="eden-btn eden-btn-square eden-btn-ghost"
								aria-label="Close"
								onClick={(e) => {
									e.stopPropagation();
									triggerClose();
								}}
							>
								✕
							</button>
						</div>
					</div>
					<div class="eden-card-grid" style="padding: var(--eden-space-lg); overflow-y: auto;">
						<For each={props.apps}>
							{(app) => (
								<div
									class="eden-card eden-card-interactive"
									style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%;"
									classList={{ running: app.isRunning }}
									onClick={async () => {
										if (contextMenu() || isClosing()) {
											return;
										}
										await handleTileClick(app.id);
									}}
									onContextMenu={(e) =>
										handleContextMenu(e, app.id, app.name, app.isRunning)
									}
									onMouseDown={(e) => {
										if (e.button === 0) {
											handleLongPressStart(e, app.id, app.name, app.isRunning);
										}
									}}
									onMouseUp={handleLongPressEnd}
									onMouseLeave={handleLongPressEnd}
									onTouchStart={(e) =>
										handleLongPressStart(e, app.id, app.name, app.isRunning)
									}
									onTouchEnd={handleLongPressEnd}
									onTouchCancel={handleLongPressEnd}
								>
									<AppIcon
										appId={app.id}
										appName={app.name}
										icon={app.icon}
										isRunning={app.isRunning}
									/>
								</div>
							)}
						</For>
					</div>
				</div>
			</div>

			<Show when={contextMenu()}>
				{(menu) => (
					<>
						<div
							class="eden-modal-overlay"
							style="background: transparent; backdrop-filter: none;"
							onClick={() => setContextMenu(null)}
						/>
						<div
							class="eden-popover"
							style={{
								left: `${menu().x}px`,
								top: `${menu().y}px`,
							}}
						>
							<div class="eden-popover-title" style="border-bottom: 1px solid var(--eden-color-border-light); padding-bottom: var(--eden-space-xs); margin-bottom: var(--eden-space-xs);">{menu().appName}</div>
							<Show when={menu().isRunning}>
								<button
									class="eden-btn eden-btn-ghost eden-btn-sm eden-btn-full"
									style="justify-content: flex-start; width: 100%;"
									onClick={async () => {
										await props.onStopApp(menu().appId);
										setContextMenu(null);
									}}
								>
									<span class="eden-icon">■</span>
									Stop App
								</button>
							</Show>
							<button
								class="eden-btn eden-btn-ghost eden-btn-sm eden-btn-full"
								style="justify-content: flex-start; width: 100%;"
								onClick={async () => {
									try {
										const result = await window.edenAPI.shellCommand("package/toggle-hot-reload", { appId: menu().appId });
										const newSet = new Set(hotReloadApps());
										if (result.enabled) {
											newSet.add(menu().appId);
										} else {
											newSet.delete(menu().appId);
										}
										setHotReloadApps(newSet);
									} catch (error) {
										console.error('Failed to toggle hot reload:', error);
									}
									setContextMenu(null);
								}}
							>
								<span class="eden-icon">{hotReloadApps().has(menu().appId) ? '🔥' : '⚡'}</span>
								{hotReloadApps().has(menu().appId) ? 'Disable' : 'Enable'} Hot Reload
							</button>
							<button
								class="eden-btn eden-btn-ghost eden-btn-sm eden-btn-danger"
								style="justify-content: flex-start; width: 100%;"
								onClick={async () => {
									await props.onUninstallApp(menu().appId);
									setContextMenu(null);
								}}
							>
								<span class="eden-icon">×</span>
								Uninstall
							</button>
						</div>
					</>
				)}
			</Show>
		</>
	);
}


