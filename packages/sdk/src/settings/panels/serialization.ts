import { SettingsPanelValidationError } from "./errors";

export function cloneRendererValue<T>(value: T): T {
  const seen = new Set<object>();
  const clone = (item: unknown, path: string): unknown => {
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return item;
    if (typeof item === "number") {
      if (!Number.isFinite(item))
        throw new SettingsPanelValidationError({
          message: `Non-finite number at ${path}`,
        });
      return item;
    }
    if (item === undefined) return undefined;
    if (typeof item !== "object")
      throw new SettingsPanelValidationError({
        message: `Non-serializable value at ${path}`,
      });
    if (seen.has(item))
      throw new SettingsPanelValidationError({
        message: `Cyclic value at ${path}`,
      });
    seen.add(item);
    if (Array.isArray(item)) {
      const result = item.map((child, index) =>
        clone(child, `${path}.${index}`),
      );
      seen.delete(item);
      return result;
    }
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null)
      throw new SettingsPanelValidationError({
        message: `Non-plain object at ${path}`,
      });
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(item)) {
      const copied = clone(child, `${path}.${key}`);
      if (copied !== undefined) result[key] = copied;
    }
    seen.delete(item);
    return result;
  };
  return clone(value, "value") as T;
}
