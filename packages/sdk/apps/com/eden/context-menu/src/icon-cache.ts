import type { ContextMenuIcon, ContextMenuItem } from "@edenapp/types";

const iconCache = new Map<string, string | undefined>();

function getAppIconId(icon?: ContextMenuIcon): string | null {
  if (!icon || typeof icon === "string") return null;
  return icon.type === "app" ? icon.appId : null;
}

function collectAppIconIds(
  items: ContextMenuItem[],
  appIds: Set<string>,
): void {
  for (const item of items) {
    if (item.type !== "item") continue;

    const appId = getAppIconId(item.icon);
    if (appId) {
      appIds.add(appId);
    }

    if (item.items?.length) {
      collectAppIconIds(item.items, appIds);
    }
  }
}

export async function ensureMenuAppIcons(
  items: ContextMenuItem[],
): Promise<void> {
  const appIds = new Set<string>();
  collectAppIconIds(items, appIds);

  await Promise.all([...appIds].map((appId) => fetchAppIcon(appId)));
}

export async function fetchAppIcon(appId: string): Promise<string | undefined> {
  if (iconCache.has(appId)) {
    return iconCache.get(appId);
  }

  try {
    const result = await window.edenAPI.shellCommand("package/get-icon", {
      appId,
    });
    iconCache.set(appId, result.icon);
    return result.icon;
  } catch (error) {
    console.warn(`Failed to fetch icon for ${appId}:`, error);
    iconCache.set(appId, undefined);
    return undefined;
  }
}

export function getCachedAppIcon(appId: string): string | undefined {
  return iconCache.get(appId);
}
