import type {
  SettingsPanelValidation,
  SettingsPanelValue,
} from "@edenapp/types";
import * as v from "valibot";
import { SettingsPanelValidationError } from "../errors";

const ITEM_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
export const nonBlank = v.pipe(v.string(), v.regex(/\S/));
export const itemId = v.pipe(v.string(), v.regex(ITEM_ID));
export const finite = v.pipe(v.number(), v.finite());
export const localized = v.union([
  nonBlank,
  v.pipe(
    v.record(v.string(), nonBlank),
    v.check((value) => Object.keys(value).length > 0),
  ),
]);
export const jsonValue: v.GenericSchema<SettingsPanelValue> = v.lazy(() =>
  v.union([
    v.string(),
    finite,
    v.boolean(),
    v.null(),
    v.array(jsonValue),
    v.record(v.string(), jsonValue),
  ]),
);

export const validation = v.strictObject({
  required: v.optional(v.boolean()),
  minLength: v.optional(finite),
  maxLength: v.optional(finite),
  pattern: v.optional(v.string()),
  min: v.optional(finite),
  max: v.optional(finite),
  step: v.optional(finite),
});

export const issuePath = (
  issues: readonly { path?: readonly { key: unknown }[] }[],
): string | undefined =>
  issues[0]?.path?.map(({ key }) => String(key)).join(".");

export const validateRules = (
  rules: SettingsPanelValidation | undefined,
  path: string,
): void => {
  if (!rules) return;
  if (
    (rules.minLength !== undefined && rules.minLength < 0) ||
    (rules.maxLength !== undefined && rules.maxLength < 0) ||
    (rules.step !== undefined && rules.step <= 0) ||
    (rules.min !== undefined &&
      rules.max !== undefined &&
      rules.min > rules.max) ||
    (rules.minLength !== undefined &&
      rules.maxLength !== undefined &&
      rules.minLength > rules.maxLength)
  )
    throw new SettingsPanelValidationError({
      message: `Invalid validation rules at ${path}`,
    });
  if (rules.pattern) {
    try {
      new RegExp(rules.pattern);
    } catch {
      throw new SettingsPanelValidationError({
        message: `Invalid validation pattern at ${path}.pattern`,
      });
    }
  }
};
