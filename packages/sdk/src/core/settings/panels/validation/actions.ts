import type {
  SettingsPanelActionDefinition,
  SettingsPanelActionInputSchema,
  SettingsPanelActionInvocation,
  SettingsPanelValue,
} from "@edenapp/types";
import * as v from "valibot";
import { cloneRendererValue } from "../serialization";
import { issuePath, jsonValue } from "./primitives";

export interface ValidationFailure {
  path: string;
  message: string;
}

const invocationSchema = v.strictObject({
  params: v.optional(v.record(v.string(), jsonValue)),
  value: v.optional(jsonValue),
  fields: v.optional(v.record(v.string(), jsonValue)),
});

export function validatePanelActionInput(
  value: SettingsPanelValue | undefined,
  schema: SettingsPanelActionInputSchema | undefined,
  path: string,
): ValidationFailure[] {
  if (!schema)
    return value === undefined
      ? []
      : [{ path, message: "This action does not accept this member." }];
  if (value === undefined || value === null)
    return schema.required
      ? [{ path, message: "This value is required." }]
      : [];
  if (schema.type === "any") return [];
  if (schema.type === "string") {
    if (typeof value !== "string") return [{ path, message: "Expected text." }];
    if (schema.minLength !== undefined && value.length < schema.minLength)
      return [{ path, message: `Minimum length is ${schema.minLength}.` }];
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      return [{ path, message: `Maximum length is ${schema.maxLength}.` }];
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      return [{ path, message: "The value has an invalid format." }];
    if (schema.enum && !schema.enum.includes(value))
      return [{ path, message: "The value is not an allowed option." }];
    return [];
  }
  if (schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value))
      return [{ path, message: "Expected a number." }];
    if (schema.min !== undefined && value < schema.min)
      return [{ path, message: `Minimum value is ${schema.min}.` }];
    if (schema.max !== undefined && value > schema.max)
      return [{ path, message: `Maximum value is ${schema.max}.` }];
    if (schema.enum && !schema.enum.includes(value))
      return [{ path, message: "The value is not an allowed option." }];
    return [];
  }
  if (schema.type === "boolean")
    return typeof value === "boolean"
      ? []
      : [{ path, message: "Expected true or false." }];
  if (schema.type === "array") {
    if (!Array.isArray(value)) return [{ path, message: "Expected a list." }];
    return schema.items
      ? value.flatMap((item, index) =>
          validatePanelActionInput(item, schema.items, `${path}.${index}`),
        )
      : [];
  }
  if (typeof value !== "object" || Array.isArray(value) || value === null)
    return [{ path, message: "Expected an object." }];
  const failures: ValidationFailure[] = [];
  const properties = schema.properties ?? {};
  for (const [key, child] of Object.entries(properties))
    failures.push(
      ...validatePanelActionInput(value[key], child, `${path}.${key}`),
    );
  if (schema.additionalProperties === false)
    for (const key of Object.keys(value))
      if (!(key in properties))
        failures.push({
          path: `${path}.${key}`,
          message: "This field is not allowed.",
        });
  return failures;
}

export function cloneAndValidatePanelActionInvocation(
  invocation: SettingsPanelActionInvocation,
  definition: SettingsPanelActionDefinition,
): {
  invocation: SettingsPanelActionInvocation;
  failures: ValidationFailure[];
} {
  let cloned: SettingsPanelActionInvocation;
  try {
    cloned = cloneRendererValue(invocation);
  } catch {
    return {
      invocation: {},
      failures: [
        { path: "invocation", message: "This invocation is invalid." },
      ],
    };
  }
  const parsed = v.safeParse(invocationSchema, cloned);
  if (!parsed.success) {
    const path = issuePath(parsed.issues) ?? "invocation";
    return {
      invocation: cloned,
      failures: [{ path, message: "This invocation is invalid." }],
    };
  }
  return {
    invocation: cloned,
    failures: [
      ...validatePanelActionInput(cloned.params, definition.params, "params"),
      ...validatePanelActionInput(cloned.value, definition.value, "value"),
      ...validatePanelActionInput(cloned.fields, definition.fields, "fields"),
    ],
  };
}
