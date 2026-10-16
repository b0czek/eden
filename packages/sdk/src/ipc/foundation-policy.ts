const FOUNDATION_COMMANDS = new Set([
  "appearance/get-wallpaper",
  "event/subscribe",
  "event/unsubscribe",
  "view/get-interface-scale",
  "view/global-mouseup",
  "view/update-global-bounds",
]);

const FOUNDATION_EVENTS = new Set([
  "appearance/wallpaper-changed",
  "view/interface-scale-changed",
]);

export function assertFoundationCommandAllowed(command: string): void {
  if (!FOUNDATION_COMMANDS.has(command)) {
    throw new Error(`Foundation is not allowed to execute ${command}`);
  }
}

export function assertFoundationEventAllowed(eventName: string): void {
  if (!FOUNDATION_EVENTS.has(eventName)) {
    throw new Error(`Foundation is not allowed to subscribe to ${eventName}`);
  }
}
