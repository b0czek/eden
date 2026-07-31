import type {
  SettingsPanelActionInputSchema,
  SettingsPanelControl,
  SettingsPanelDefinition,
  SettingsPanelProvider,
  SettingsPanelValidation,
  SettingsPanelValue,
} from "@edenapp/types";
import * as v from "valibot";

export type InternalPanelDefinition = Omit<SettingsPanelDefinition, "grant"> & {
  grant?: string;
};

export interface ValidationFailure {
  path: string;
  message: string;
}

const PANEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const ITEM_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
const nonBlank = v.pipe(v.string(), v.regex(/\S/));
const itemId = v.pipe(v.string(), v.regex(ITEM_ID));
const finiteNumber = v.pipe(v.number(), v.finite());
const localizedText = v.union([
  nonBlank,
  v.pipe(
    v.record(v.string(), nonBlank),
    v.check((value) => Object.keys(value).length > 0),
  ),
]);
const validation = v.object({
  required: v.optional(v.boolean()),
  minLength: v.optional(finiteNumber),
  maxLength: v.optional(finiteNumber),
  pattern: v.optional(v.string()),
  min: v.optional(finiteNumber),
  max: v.optional(finiteNumber),
  step: v.optional(finiteNumber),
});
const option = v.object({
  value: v.string(),
  label: localizedText,
  description: v.optional(localizedText),
});
const inputType = v.picklist([
  "text",
  "password",
  "number",
  "checkbox",
  "radio",
  "select",
  "textarea",
  "color",
  "range",
]);
const field = v.object({
  id: itemId,
  label: localizedText,
  description: v.optional(localizedText),
  input: inputType,
  placeholder: v.optional(localizedText),
  options: v.optional(v.array(option)),
  validation: v.optional(validation),
  autocomplete: v.optional(v.string()),
});
const controlBase = {
  id: itemId,
  label: localizedText,
  description: v.optional(localizedText),
};
const control = v.variant("kind", [
  v.object({ ...controlBase, kind: v.literal("status"), stateKey: nonBlank }),
  v.object({
    ...controlBase,
    kind: v.literal("toggle"),
    stateKey: nonBlank,
    actionId: itemId,
  }),
  v.object({
    ...controlBase,
    kind: v.literal("button"),
    actionId: itemId,
    tone: v.optional(
      v.picklist(["neutral", "info", "success", "warning", "danger"]),
    ),
    confirmation: v.optional(localizedText),
  }),
  v.object({
    ...controlBase,
    kind: v.literal("input"),
    stateKey: nonBlank,
    actionId: itemId,
    input: inputType,
    placeholder: v.optional(localizedText),
    options: v.optional(v.array(option)),
    validation: v.optional(validation),
  }),
  v.object({
    ...controlBase,
    kind: v.literal("dialog"),
    actionId: itemId,
    buttonLabel: localizedText,
    dialog: v.object({
      title: localizedText,
      description: v.optional(localizedText),
      fields: v.pipe(v.array(field), v.nonEmpty()),
      submitLabel: localizedText,
      cancelLabel: localizedText,
    }),
  }),
]);
const actionInputSchema: v.GenericSchema = v.lazy(() =>
  v.variant("type", [
    v.object({
      type: v.literal("string"),
      required: v.optional(v.boolean()),
      minLength: v.optional(finiteNumber),
      maxLength: v.optional(finiteNumber),
      pattern: v.optional(v.string()),
      enum: v.optional(v.array(v.string())),
    }),
    v.object({
      type: v.literal("number"),
      required: v.optional(v.boolean()),
      min: v.optional(finiteNumber),
      max: v.optional(finiteNumber),
      enum: v.optional(v.array(finiteNumber)),
    }),
    v.object({ type: v.literal("boolean"), required: v.optional(v.boolean()) }),
    v.object({
      type: v.literal("array"),
      required: v.optional(v.boolean()),
      items: v.optional(actionInputSchema),
    }),
    v.object({
      type: v.literal("object"),
      required: v.optional(v.boolean()),
      properties: v.optional(v.record(v.string(), actionInputSchema)),
      additionalProperties: v.optional(v.boolean()),
    }),
    v.object({ type: v.literal("any"), required: v.optional(v.boolean()) }),
  ]),
);
const action = v.object({
  id: itemId,
  label: v.optional(localizedText),
  description: v.optional(localizedText),
  grant: v.optional(nonBlank),
  input: v.optional(actionInputSchema),
});
const panelDefinition = v.object({
  id: v.pipe(v.string(), v.regex(PANEL_ID)),
  title: localizedText,
  description: v.optional(localizedText),
  icon: v.optional(v.string()),
  grant: v.optional(nonBlank),
  sections: v.array(
    v.object({
      id: itemId,
      title: v.optional(localizedText),
      description: v.optional(localizedText),
      controls: v.array(control),
    }),
  ),
  actions: v.optional(v.array(action)),
});

export function cloneRendererValue<T>(value: T): T {
  const seen = new Set<object>();
  const clone = (item: unknown, path: string): unknown => {
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "boolean"
    ) {
      return item;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item))
        throw new Error(`Non-finite number at ${path}`);
      return item;
    }
    if (item === undefined) return undefined;
    if (typeof item !== "object")
      throw new Error(`Non-serializable value at ${path}`);
    if (seen.has(item)) throw new Error(`Cyclic value at ${path}`);
    seen.add(item);
    if (Array.isArray(item)) {
      const result = item.map((child, index) =>
        clone(child, `${path}.${index}`),
      );
      seen.delete(item);
      return result;
    }
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`Non-plain object at ${path}`);
    }
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(item)) {
      const cloned = clone(child, `${path}.${key}`);
      if (cloned !== undefined) result[key] = cloned;
    }
    seen.delete(item);
    return result;
  };
  return clone(value, "value") as T;
}

const validateRules = (
  rules: SettingsPanelValidation | undefined,
  id: string,
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
  ) {
    throw new Error(`Input "${id}" has invalid validation rules`);
  }
  if (rules.pattern) {
    try {
      new RegExp(rules.pattern);
    } catch {
      throw new Error(`Input "${id}" has an invalid validation pattern`);
    }
  }
};

const validateInput = (
  input: string,
  options: { value: string }[] | undefined,
  id: string,
): void => {
  if ((input === "select" || input === "radio") && !options?.length) {
    throw new Error(`Input "${id}" requires options`);
  }
  if (
    options &&
    new Set(options.map(({ value }) => value)).size !== options.length
  ) {
    throw new Error(`Input "${id}" has invalid options`);
  }
};

const validateControl = (value: SettingsPanelControl): void => {
  if (value.kind === "input") {
    if (value.input === "password") {
      throw new Error(
        `Password input "${value.id}" must be component-local inside a dialog`,
      );
    }
    validateInput(value.input, value.options, value.id);
    validateRules(value.validation, value.id);
  }
  if (value.kind === "dialog") {
    const ids = value.dialog.fields.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      throw new Error(
        `Duplicate dialog field "${ids.find((id, index) => ids.indexOf(id) !== index)}"`,
      );
    }
    for (const item of value.dialog.fields) {
      validateInput(item.input, item.options, item.id);
      validateRules(item.validation, item.id);
    }
  }
};

const validateActionSchema = (
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
    ) {
      throw new Error(`Invalid action schema at ${path}`);
    }
  }
  if (schema.type === "number") {
    validateRules({ min: schema.min, max: schema.max }, path);
    if (
      schema.enum &&
      (schema.enum.length === 0 ||
        new Set(schema.enum).size !== schema.enum.length)
    ) {
      throw new Error(`Invalid action schema at ${path}`);
    }
  }
  if (schema.type === "array" && schema.items) {
    validateActionSchema(schema.items, `${path}[]`);
  }
  if (schema.type === "object") {
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      validateActionSchema(child, `${path}.${key}`);
    }
  }
};

export function cloneAndValidatePanelDefinition(
  definition: InternalPanelDefinition,
): InternalPanelDefinition {
  const cloned = cloneRendererValue(definition);
  const parsed = v.safeParse(panelDefinition, cloned);
  if (!parsed.success) {
    const path = parsed.issues[0]?.path
      ?.map((item) => String(item.key))
      .join(".");
    throw new Error(
      `Invalid settings panel declaration${path ? ` at ${path}` : ""}`,
    );
  }

  const sectionIds = new Set<string>();
  const controlIds = new Set<string>();
  const referencedActions = new Set<string>();
  for (const section of cloned.sections) {
    if (sectionIds.has(section.id)) {
      throw new Error(`Duplicate settings panel section "${section.id}"`);
    }
    sectionIds.add(section.id);
    for (const item of section.controls) {
      validateControl(item);
      if (controlIds.has(item.id)) {
        throw new Error(`Duplicate settings panel control "${item.id}"`);
      }
      controlIds.add(item.id);
      if ("actionId" in item) referencedActions.add(item.actionId);
    }
  }

  const actionIds = new Set<string>();
  for (const item of cloned.actions ?? []) {
    if (actionIds.has(item.id)) {
      throw new Error(`Duplicate settings panel action "${item.id}"`);
    }
    actionIds.add(item.id);
    if (item.input) validateActionSchema(item.input, "input");
  }
  for (const actionId of referencedActions) {
    if (!actionIds.has(actionId)) {
      throw new Error(`Control references undeclared action "${actionId}"`);
    }
  }
  return cloned;
}

export function validatePanelProvider(
  definition: InternalPanelDefinition,
  provider: SettingsPanelProvider,
): void {
  if (!provider || typeof provider.load !== "function") {
    throw new Error("Settings panel provider requires a load function");
  }
  for (const action of definition.actions ?? []) {
    if (typeof provider.actions?.[action.id] !== "function") {
      throw new Error(
        `Settings panel provider is missing action "${action.id}"`,
      );
    }
  }
  for (const [id, handler] of Object.entries(provider.actions ?? {})) {
    if (typeof handler !== "function") {
      throw new Error(`Settings panel action "${id}" must be a function`);
    }
    if (!definition.actions?.some((action) => action.id === id)) {
      throw new Error(`Settings panel provider has undeclared action "${id}"`);
    }
  }
}

export function validatePanelActionInput(
  value: SettingsPanelValue | undefined,
  schema: SettingsPanelActionInputSchema | undefined,
  path = "input",
): ValidationFailure[] {
  if (!schema) {
    return value === undefined
      ? []
      : [{ path, message: "This action does not accept input." }];
  }
  if (value === undefined || value === null) {
    return schema.required
      ? [{ path, message: "This value is required." }]
      : [];
  }
  if (schema.type === "any") return [];
  if (schema.type === "string") {
    if (typeof value !== "string") return [{ path, message: "Expected text." }];
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return [{ path, message: `Minimum length is ${schema.minLength}.` }];
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return [{ path, message: `Maximum length is ${schema.maxLength}.` }];
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      return [{ path, message: "The value has an invalid format." }];
    }
    if (schema.enum && !schema.enum.includes(value)) {
      return [{ path, message: "The value is not an allowed option." }];
    }
    return [];
  }
  if (schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return [{ path, message: "Expected a number." }];
    }
    if (schema.min !== undefined && value < schema.min) {
      return [{ path, message: `Minimum value is ${schema.min}.` }];
    }
    if (schema.max !== undefined && value > schema.max) {
      return [{ path, message: `Maximum value is ${schema.max}.` }];
    }
    if (schema.enum && !schema.enum.includes(value)) {
      return [{ path, message: "The value is not an allowed option." }];
    }
    return [];
  }
  if (schema.type === "boolean") {
    return typeof value === "boolean"
      ? []
      : [{ path, message: "Expected true or false." }];
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return [{ path, message: "Expected a list." }];
    return schema.items
      ? value.flatMap((item, index) =>
          validatePanelActionInput(item, schema.items, `${path}.${index}`),
        )
      : [];
  }
  if (typeof value !== "object" || Array.isArray(value) || value === null) {
    return [{ path, message: "Expected an object." }];
  }
  const failures: ValidationFailure[] = [];
  const properties = schema.properties ?? {};
  for (const [key, child] of Object.entries(properties)) {
    failures.push(
      ...validatePanelActionInput(value[key], child, `${path}.${key}`),
    );
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!(key in properties)) {
        failures.push({
          path: `${path}.${key}`,
          message: "This field is not allowed.",
        });
      }
    }
  }
  return failures;
}
