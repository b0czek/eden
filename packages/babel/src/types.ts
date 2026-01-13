/**
 * Utility types for typed i18n system.
 * 
 * These types allow extracting translation keys and interpolation arguments
 * directly from locale object types using TypeScript's type inference.
 */

// =============================================================================
// Flattening Types - Convert nested objects to dot-notation keys
// =============================================================================

/**
 * Recursively flatten a nested object type into dot-notation keys.
 * 
 * Example:
 * ```ts
 * type Input = { files: { newFolder: string; create: { file: string } } }
 * type Output = FlattenKeys<Input>
 * // = { "files.newFolder": string } | { "files.create.file": string }
 * ```
 */
type FlattenKeys<T, Prefix extends string = ""> = T extends object
  ? T extends string  // Guard against string being treated as object
    ? { [P in Prefix]: T }
    : {
        [K in keyof T & string]: T[K] extends object
          ? T[K] extends string
            ? { [P in `${Prefix}${K}`]: T[K] }
            : FlattenKeys<T[K], `${Prefix}${K}.`>
          : { [P in `${Prefix}${K}`]: T[K] };
      }[keyof T & string]
  : never;

/**
 * Convert a union of single-property objects into an intersection (merged object).
 * 
 * Example:
 * ```ts
 * type Input = { a: string } | { b: number }
 * type Output = UnionToIntersection<Input>
 * // = { a: string } & { b: number } = { a: string; b: number }
 * ```
 */
type UnionToIntersection<U> = (
  U extends any ? (x: U) => void : never
) extends (x: infer I) => void
  ? I
  : never;

/**
 * Flatten a locale object type into a flat object with dot-notation keys.
 * 
 * Example:
 * ```ts
 * const en = { files: { newFolder: "New Folder", newFile: "New File" } };
 * type Flat = FlattenLocale<typeof en>;
 * // = { "files.newFolder": string; "files.newFile": string }
 * ```
 */
export type FlattenLocale<T> = UnionToIntersection<FlattenKeys<T>>;

// =============================================================================
// Argument Extraction Types - Parse interpolation placeholders from strings
// =============================================================================

/**
 * Extract interpolation argument names from a string literal type.
 * Matches patterns like {name}, {count}, etc.
 * 
 * Example:
 * ```ts
 * type Args = ExtractArgNames<"Hello {name}, you have {count} messages">;
 * // = "name" | "count"
 * ```
 */
type ExtractArgNames<S extends string> = S extends `${infer _Start}{${infer Arg}}${infer Rest}`
  ? Arg | ExtractArgNames<Rest>
  : never;

/**
 * Convert a string literal type to its argument requirements.
 * - Returns void if no interpolation placeholders
 * - Returns { argName: string | number } for each placeholder
 * 
 * Example:
 * ```ts
 * type NoArgs = StringToArgs<"Hello world">;  // = void
 * type WithArgs = StringToArgs<"Delete {name}?">;  // = { name: string | number }
 * ```
 */
type StringToArgs<S extends string> = ExtractArgNames<S> extends never
  ? void
  : { [K in ExtractArgNames<S>]: string | number };

/**
 * Convert a flattened locale object to a translations map with argument types.
 * 
 * Example:
 * ```ts
 * type Flat = { "common.ok": "OK"; "common.delete": "Delete {name}?" };
 * type Trans = LocaleToTranslations<Flat>;
 * // = { "common.ok": void; "common.delete": { name: string | number } }
 * ```
 */
export type LocaleToTranslations<T> = {
  [K in keyof T]: T[K] extends string ? StringToArgs<T[K]> : void;
};

// =============================================================================
// Combined Helper - One-step conversion from locale to translations
// =============================================================================

/**
 * Convert a locale object directly to a typed translations map.
 * Combines flattening and argument extraction in one step.
 * 
 * Example:
 * ```ts
 * const en = { files: { newFile: "New File", delete: "Delete {name}?" } };
 * type Trans = InferTranslations<typeof en>;
 * // = { "files.newFile": void; "files.delete": { name: string | number } }
 * ```
 */
export type InferTranslations<T> = LocaleToTranslations<FlattenLocale<T>>;

// =============================================================================
// Translation Function Types - Framework-agnostic i18n types
// =============================================================================

/**
 * Type-safe translate function.
 * 
 * - Keys without interpolation: `t("key")`
 * - Keys with interpolation: `t("key", { arg: value })`
 * 
 * TypeScript will enforce correct usage based on the translation strings.
 * 
 * Example:
 * ```ts
 * type Translations = {
 *   "common.ok": void;
 *   "common.delete": { name: string | number };
 * };
 * 
 * const t: TranslateFn<Translations> = ...;
 * t("common.ok");  // ✅ No args needed
 * t("common.delete", { name: "file.txt" });  // ✅ Args required
 * t("common.delete");  // ❌ Error: missing args
 * ```
 */
export type TranslateFn<T> = <K extends keyof T & string>(
  key: K,
  ...args: T[K] extends void ? [] : [T[K]]
) => string;

/**
 * Return type for i18n setup functions.
 * Provides the translate function and locale management.
 */
export interface EdenI18nHandle<T = Record<string, void>> {
  /**
   * Type-safe translate function.
   */
  t: TranslateFn<T>;
  
  /**
   * Current locale accessor (framework-specific, e.g., signal for SolidJS).
   */
  locale: any;
  
  /**
   * Locale setter (framework-specific, e.g., setter for SolidJS).
   */
  setLocale: any;
  
  /**
   * Initialize function to load settings from system.
   * Call this in your app's initialization.
   */
  initLocale: () => Promise<void>;
}

