// Cache for fetched icons to avoid redundant API calls
const iconCache = new Map<string, string | undefined>();

/**
 * Retrieves the base64 data URL for an app's icon, using an internal cache when available.
 *
 * @param appId - The application identifier (package id) whose icon to fetch.
 * @returns The icon as a base64 data URL, or `undefined` if the icon could not be retrieved.
 */
export async function fetchAppIcon(appId: string): Promise<string | undefined> {
  // Check cache first
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