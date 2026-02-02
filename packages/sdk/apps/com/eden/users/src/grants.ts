import type {
  SettingDefinition,
  SettingsCategory,
  ResolvedGrant,
  RuntimeAppManifest,
} from "@edenapp/types";

export const isCustomViewCategory = (category: SettingsCategory): boolean =>
  Boolean(category.view);

export const resolveCategoryGrantTarget = (
  category: SettingsCategory,
): string | null => {
  const hasView = isCustomViewCategory(category);
  if (category.grantScope === "global") {
    return null;
  }
  if (!category.grant && !hasView) {
    return null;
  }

  return category.grant ?? category.id;
};

export const resolveSettingGrantTarget = (
  category: SettingsCategory,
  setting: SettingDefinition,
): string => {
  const categoryGrantKey =
    category.grantScope === "global" ? undefined : category.grant;
  const parentKey = categoryGrantKey ?? category.id;
  if (setting.grant) {
    return `${parentKey}/${setting.grant}`;
  }
  if (categoryGrantKey) {
    return parentKey;
  }
  return setting.key;
};

// ---------------------------------------------------------------------------
// Grant builders and parsers
// ---------------------------------------------------------------------------

const RESERVED_PREFIXES = ["apps/launch/", "settings/", "app/", "preset/"];

/** Build a settings grant string */
export const buildSettingGrant = (appId: string, key: string) =>
  `settings/${appId}/${key}`;

/** Build an app launch grant string */
export const buildAppGrant = (appId: string) => `apps/launch/${appId}`;

/** Build an app-specific feature grant string */
export const buildAppFeatureGrant = (appId: string, grantId: string) =>
  `app/${appId}/${grantId}`;

/** Build a preset grant string */
export const buildPresetGrant = (presetId: string) => `preset/${presetId}`;

export const isCustomGrant = (grant: string) =>
  grant !== "*" &&
  !RESERVED_PREFIXES.some((prefix) => grant.startsWith(prefix));

export const getCustomGrants = (grants: string[]) =>
  grants.filter((grant) => isCustomGrant(grant));

export const parseCustomGrantInput = (input: string) =>
  input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => isCustomGrant(line));

// ---------------------------------------------------------------------------
// Grant matching utilities
// ---------------------------------------------------------------------------

/**
 * Checks if a user's grants include the required grant (with wildcard support)
 */
export const matchesGrant = (grants: string[], required: string): boolean => {
  if (grants.includes(required)) {
    return true;
  }
  for (const granted of grants) {
    if (granted === "*") {
      return true;
    }
    if (granted.endsWith("/*")) {
      const namespace = granted.slice(0, -2);
      if (required.startsWith(`${namespace}/`)) {
        return true;
      }
    }
  }
  return false;
};

/**
 * Checks if a user can launch a given app based on their grants
 */
export const canLaunchApp = (
  app: RuntimeAppManifest,
  grants: string[],
  isVendor: boolean,
): boolean => {
  if (isVendor) return true;
  if (app.isRestricted) return false;
  if (app.isCore) return true;
  return matchesGrant(grants, buildAppGrant(app.id));
};

/**
 * Gets the scope of a resolved grant
 */
export const getGrantScope = (grant: ResolvedGrant): "app" | "preset" =>
  grant.scope === "preset" ? "preset" : "app";

/**
 * Gets the ID of a resolved grant
 */
export const getGrantId = (grant: ResolvedGrant): string =>
  grant.scope === "preset" ? (grant.id ?? grant.preset) : (grant.id ?? "");

/**
 * Gets the label of a resolved grant
 */
export const getGrantLabel = (
  grant: ResolvedGrant,
): string | Record<string, string> =>
  grant.label ?? (grant.scope === "preset" ? grant.preset : (grant.id ?? ""));

/**
 * Gets resolved grants for an app
 */
export const getResolvedGrants = (app: RuntimeAppManifest): ResolvedGrant[] =>
  app.resolvedGrants;

/**
 * Gets app-scoped grants for an app
 */
export const getAppScopedGrants = (app: RuntimeAppManifest): ResolvedGrant[] =>
  getResolvedGrants(app).filter((grant) => getGrantScope(grant) === "app");

/**
 * Builds the grant key for an app feature or preset
 */
export const getAppGrantKey = (
  appId: string,
  grantId?: string,
  scope?: string,
): string => {
  if (!grantId) {
    return "";
  }
  if (scope === "preset") {
    return buildPresetGrant(grantId);
  }
  return buildAppFeatureGrant(appId, grantId);
};

/**
 * Checks if user has a specific app feature grant
 */
export const hasAppFeatureGrant = (
  grants: string[],
  appId: string,
  grantId?: string,
  scope?: string,
): boolean => {
  const key = getAppGrantKey(appId, grantId, scope);
  if (!key) return false;
  return matchesGrant(grants, key);
};

/**
 * Checks if user has a specific preset grant
 */
export const hasPresetGrant = (grants: string[], grantId: string): boolean => {
  return matchesGrant(grants, buildPresetGrant(grantId));
};
