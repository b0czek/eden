// Cache for fetched icons to avoid redundant API calls
const iconCache = new Map<string, string | undefined>();

/**
 * Fetch an app icon as a base64 data URL
 */
export async function fetchAppIcon(appId: string): Promise<string | undefined> {
  // Check cache first
  if (iconCache.has(appId)) {
    return iconCache.get(appId);
  }

  try {
    const result = await window.edenAPI!.shellCommand("package/get-icon", {
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

/**
 * Clear the icon cache (useful for refreshing after app updates)
 */
export function clearIconCache(): void {
  iconCache.clear();
}

/**
 * Remove a specific app's icon from cache
 */
export function invalidateIconCache(appId: string): void {
  iconCache.delete(appId);
}
