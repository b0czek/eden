/**
 * Normalizes an array of app IDs by trimming whitespace and removing empty strings.
 * Returns a Set to ensure uniqueness.
 */
export function normalizeAppIds(appIds?: string[]): Set<string> {
  if (!appIds || appIds.length === 0) {
    return new Set();
  }
  const normalized = appIds.map((appId) => appId.trim()).filter(Boolean);
  return new Set(normalized);
}
