import type {
  SettingsPanelActionInputSchema,
  SettingsPanelDefinition,
} from "@edenapp/types";
import * as v from "valibot";
import { SettingsPanelValidationError } from "../errors";
import { cloneRendererValue } from "../serialization";
import type { InternalSettingsPanelProvider } from "../types";
import {
  finite,
  issuePath,
  itemId,
  localized,
  nonBlank,
  validateRules,
} from "./primitives";

const PANEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

const actionSchema: v.GenericSchema<SettingsPanelActionInputSchema> = v.lazy(
  () =>
    v.variant("type", [
      v.strictObject({
        type: v.literal("string"),
        required: v.optional(v.boolean()),
        minLength: v.optional(finite),
        maxLength: v.optional(finite),
        pattern: v.optional(v.string()),
        enum: v.optional(v.array(v.string())),
      }),
      v.strictObject({
        type: v.literal("number"),
        required: v.optional(v.boolean()),
        min: v.optional(finite),
        max: v.optional(finite),
        enum: v.optional(v.array(finite)),
      }),
      v.strictObject({
        type: v.literal("boolean"),
        required: v.optional(v.boolean()),
      }),
      v.strictObject({
        type: v.literal("array"),
        required: v.optional(v.boolean()),
        items: v.optional(actionSchema),
      }),
      v.strictObject({
        type: v.literal("object"),
        required: v.optional(v.boolean()),
        properties: v.optional(v.record(v.string(), actionSchema)),
        additionalProperties: v.optional(v.boolean()),
      }),
      v.strictObject({
        type: v.literal("any"),
        required: v.optional(v.boolean()),
      }),
    ]),
);
const objectActionSchema = v.strictObject({
  type: v.literal("object"),
  required: v.optional(v.boolean()),
  properties: v.optional(v.record(v.string(), actionSchema)),
  additionalProperties: v.optional(v.boolean()),
});
const actionDefinition = v.strictObject({
  id: itemId,
  label: v.optional(localized),
  description: v.optional(localized),
  grant: v.optional(nonBlank),
  params: v.optional(objectActionSchema),
  value: v.optional(actionSchema),
  fields: v.optional(objectActionSchema),
});
const panelDefinition = v.strictObject({
  id: v.pipe(v.string(), v.regex(PANEL_ID)),
  parentId: v.optional(v.pipe(v.string(), v.regex(PANEL_ID))),
  title: localized,
  description: v.optional(localized),
  icon: v.optional(v.string()),
  grant: v.optional(nonBlank),
  actions: v.optional(v.array(actionDefinition)),
});

const validateSchema = (
  schema: SettingsPanelActionInputSchema,
  path: string,
): void => {
  if (schema.type === "string") {
    validateRules(
      {
        minLength: schema.minLength,
        maxLength: schema.maxLength,
        pattern: schema.pattern,
      },
      path,
    );
    if (
      schema.enum &&
      (schema.enum.length === 0 ||
        new Set(schema.enum).size !== schema.enum.length)
    )
      throw new SettingsPanelValidationError({
        message: `Invalid action schema at ${path}.enum`,
      });
  } else if (schema.type === "number") {
    validateRules({ min: schema.min, max: schema.max }, path);
    if (
      schema.enum &&
      (schema.enum.length === 0 ||
        new Set(schema.enum).size !== schema.enum.length)
    )
      throw new SettingsPanelValidationError({
        message: `Invalid action schema at ${path}.enum`,
      });
  } else if (schema.type === "array" && schema.items)
    validateSchema(schema.items, `${path}[]`);
  else if (schema.type === "object")
    for (const [key, child] of Object.entries(schema.properties ?? {}))
      validateSchema(child, `${path}.${key}`);
};

export function cloneAndValidatePanelDefinition(
  definition: SettingsPanelDefinition,
): SettingsPanelDefinition {
  const cloned = cloneRendererValue(definition);
  const parsed = v.safeParse(panelDefinition, cloned);
  if (!parsed.success) {
    const path = issuePath(parsed.issues);
    throw new SettingsPanelValidationError({
      message: `Invalid settings panel definition${path ? ` at ${path}` : ""}`,
    });
  }
  const ids = new Set<string>();
  for (const action of cloned.actions ?? []) {
    if (ids.has(action.id))
      throw new SettingsPanelValidationError({
        message: `Duplicate settings panel action "${action.id}"`,
      });
    ids.add(action.id);
    if (action.grant && !action.label)
      throw new SettingsPanelValidationError({
        message: `Action "${action.id}" requires a label when it declares a grant`,
      });
    if (action.params)
      validateSchema(action.params, `actions.${action.id}.params`);
    if (action.value)
      validateSchema(action.value, `actions.${action.id}.value`);
    if (action.fields)
      validateSchema(action.fields, `actions.${action.id}.fields`);
  }
  return cloned;
}

export function validatePanelProvider(
  definition: SettingsPanelDefinition,
  provider: InternalSettingsPanelProvider,
): void {
  if (!provider || typeof provider.load !== "function")
    throw new SettingsPanelValidationError({
      message: "Settings panel provider requires a load function",
    });
  if (
    provider.actions !== undefined &&
    (provider.actions === null ||
      typeof provider.actions !== "object" ||
      Array.isArray(provider.actions))
  )
    throw new SettingsPanelValidationError({
      message: "Settings panel provider actions must be an object",
    });
  for (const action of definition.actions ?? [])
    if (typeof provider.actions?.[action.id] !== "function")
      throw new SettingsPanelValidationError({
        message: `Settings panel provider is missing action "${action.id}"`,
      });
  for (const [id, handler] of Object.entries(provider.actions ?? {})) {
    if (typeof handler !== "function")
      throw new SettingsPanelValidationError({
        message: `Settings panel action "${id}" must be a function`,
      });
    if (!definition.actions?.some((action) => action.id === id))
      throw new SettingsPanelValidationError({
        message: `Settings panel provider has undeclared action "${id}"`,
      });
  }
}
