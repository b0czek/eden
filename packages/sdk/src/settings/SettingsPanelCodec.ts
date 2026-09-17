import type {
  SettingsPanelActionBinding,
  SettingsPanelActionInputSchema,
  SettingsPanelActionInvocation,
  SettingsPanelDefinition,
  SettingsPanelNode,
  SettingsPanelProvider,
  SettingsPanelRowNode,
  SettingsPanelValidation,
  SettingsPanelValue,
  SettingsPanelView,
} from "@edenapp/types";
import * as v from "valibot";

export type InternalPanelDefinition = Omit<SettingsPanelDefinition, "grant"> & {
  grant?: string;
};
export interface ValidationFailure {
  path: string;
  message: string;
}
export class SettingsPanelViewValidationError extends Error {
  constructor(readonly path: string) {
    super(`Invalid settings panel view at ${path}`);
  }
}

const PANEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const ITEM_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
const nonBlank = v.pipe(v.string(), v.regex(/\S/));
const itemId = v.pipe(v.string(), v.regex(ITEM_ID));
const finite = v.pipe(v.number(), v.finite());
const localized = v.union([
  nonBlank,
  v.pipe(
    v.record(v.string(), nonBlank),
    v.check((value) => Object.keys(value).length > 0),
  ),
]);
const jsonValue: v.GenericSchema<SettingsPanelValue> = v.lazy(() =>
  v.union([
    v.string(),
    finite,
    v.boolean(),
    v.null(),
    v.array(jsonValue),
    v.record(v.string(), jsonValue),
  ]),
);
const badge = v.strictObject({
  label: localized,
  tone: v.optional(
    v.picklist(["neutral", "info", "success", "warning", "danger"]),
  ),
});
const validation = v.strictObject({
  required: v.optional(v.boolean()),
  minLength: v.optional(finite),
  maxLength: v.optional(finite),
  pattern: v.optional(v.string()),
  min: v.optional(finite),
  max: v.optional(finite),
  step: v.optional(finite),
});
const option = v.strictObject({
  value: v.string(),
  label: localized,
  description: v.optional(localized),
});
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
const binding = v.strictObject({
  actionId: itemId,
  params: v.optional(v.record(v.string(), jsonValue)),
});
const nodeBase = {
  id: itemId,
  label: localized,
  description: v.optional(localized),
};
const interactive = {
  ...nodeBase,
  action: binding,
  disabled: v.optional(v.boolean()),
};
const fieldBase = {
  id: itemId,
  label: localized,
  description: v.optional(localized),
  placeholder: v.optional(localized),
  validation: v.optional(validation),
  autocomplete: v.optional(v.string()),
};
const dialogField = v.variant("input", [
  v.strictObject({
    ...fieldBase,
    input: v.picklist(["text", "textarea", "color"]),
    value: v.optional(v.string()),
  }),
  v.strictObject({
    ...fieldBase,
    input: v.picklist(["select", "radio"]),
    value: v.optional(v.string()),
    options: v.pipe(v.array(option), v.nonEmpty()),
  }),
  v.strictObject({
    ...fieldBase,
    input: v.picklist(["number", "range"]),
    value: v.optional(finite),
  }),
  v.strictObject({
    ...fieldBase,
    input: v.literal("checkbox"),
    value: v.optional(v.boolean()),
  }),
  v.strictObject({ ...fieldBase, input: v.literal("password") }),
]);
const dialogContent = v.strictObject({
  title: localized,
  description: v.optional(localized),
  fields: v.pipe(v.array(dialogField), v.nonEmpty()),
  submitLabel: localized,
  cancelLabel: localized,
});
const statusNode = v.strictObject({
  ...nodeBase,
  kind: v.literal("status"),
  value: v.optional(localized),
  detail: v.optional(localized),
  badge: v.optional(badge),
});
const buttonNode = v.strictObject({
  ...interactive,
  kind: v.literal("button"),
  tone: v.optional(
    v.picklist(["neutral", "info", "success", "warning", "danger"]),
  ),
  confirmation: v.optional(localized),
});
const toggleNode = v.strictObject({
  ...interactive,
  kind: v.literal("toggle"),
  value: v.boolean(),
});
const dialogNode = v.strictObject({
  ...interactive,
  kind: v.literal("dialog"),
  buttonLabel: localized,
  dialog: dialogContent,
});
const rowNode = v.variant("kind", [
  statusNode,
  buttonNode,
  toggleNode,
  dialogNode,
]);
const inputNode = v.variant("input", [
  v.strictObject({
    ...interactive,
    kind: v.literal("input"),
    input: v.picklist(["text", "textarea", "color"]),
    value: v.string(),
    placeholder: v.optional(localized),
    validation: v.optional(validation),
  }),
  v.strictObject({
    ...interactive,
    kind: v.literal("input"),
    input: v.picklist(["select", "radio"]),
    value: v.string(),
    options: v.pipe(v.array(option), v.nonEmpty()),
    placeholder: v.optional(localized),
    validation: v.optional(validation),
  }),
  v.strictObject({
    ...interactive,
    kind: v.literal("input"),
    input: v.picklist(["number", "range"]),
    value: finite,
    placeholder: v.optional(localized),
    validation: v.optional(validation),
  }),
  v.strictObject({
    ...interactive,
    kind: v.literal("input"),
    input: v.literal("checkbox"),
    value: v.boolean(),
    placeholder: v.optional(localized),
    validation: v.optional(validation),
  }),
]);
const collectionNode = v.strictObject({
  ...nodeBase,
  kind: v.literal("collection"),
  emptyLabel: v.optional(localized),
  items: v.array(
    v.strictObject({
      id: itemId,
      title: localized,
      description: v.optional(localized),
      detail: v.optional(localized),
      badge: v.optional(badge),
      disabled: v.optional(v.boolean()),
      nodes: v.array(rowNode),
    }),
  ),
});
const node = v.variant("kind", [
  statusNode,
  buttonNode,
  toggleNode,
  inputNode,
  dialogNode,
  collectionNode,
]);
const panelView = v.strictObject({
  sections: v.array(
    v.strictObject({
      id: itemId,
      title: v.optional(localized),
      description: v.optional(localized),
      nodes: v.array(node),
    }),
  ),
});
const invocationCodec = v.strictObject({
  params: v.optional(v.record(v.string(), jsonValue)),
  value: v.optional(jsonValue),
  fields: v.optional(v.record(v.string(), jsonValue)),
});

export function cloneRendererValue<T>(value: T): T {
  const seen = new Set<object>();
  const clone = (item: unknown, path: string): unknown => {
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return item;
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
    if (prototype !== Object.prototype && prototype !== null)
      throw new Error(`Non-plain object at ${path}`);
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

const issuePath = (
  issues: readonly { path?: readonly { key: unknown }[] }[],
): string | undefined =>
  issues[0]?.path?.map(({ key }) => String(key)).join(".");

const validateRules = (
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
    throw new Error(`Invalid validation rules at ${path}`);
  if (rules.pattern) {
    try {
      new RegExp(rules.pattern);
    } catch {
      throw new Error(`Invalid validation pattern at ${path}.pattern`);
    }
  }
};

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
      throw new Error(`Invalid action schema at ${path}.enum`);
  } else if (schema.type === "number") {
    validateRules({ min: schema.min, max: schema.max }, path);
    if (
      schema.enum &&
      (schema.enum.length === 0 ||
        new Set(schema.enum).size !== schema.enum.length)
    )
      throw new Error(`Invalid action schema at ${path}.enum`);
  } else if (schema.type === "array" && schema.items)
    validateSchema(schema.items, `${path}[]`);
  else if (schema.type === "object")
    for (const [key, child] of Object.entries(schema.properties ?? {}))
      validateSchema(child, `${path}.${key}`);
};

export function cloneAndValidatePanelDefinition(
  definition: InternalPanelDefinition,
): InternalPanelDefinition {
  const cloned = cloneRendererValue(definition);
  const parsed = v.safeParse(panelDefinition, cloned);
  if (!parsed.success) {
    const path = issuePath(parsed.issues);
    throw new Error(
      `Invalid settings panel definition${path ? ` at ${path}` : ""}`,
    );
  }
  const ids = new Set<string>();
  for (const action of cloned.actions ?? []) {
    if (ids.has(action.id))
      throw new Error(`Duplicate settings panel action "${action.id}"`);
    ids.add(action.id);
    if (action.grant && !action.label)
      throw new Error(
        `Action "${action.id}" requires a label when it declares a grant`,
      );
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
  definition: InternalPanelDefinition,
  provider: SettingsPanelProvider,
): void {
  if (!provider || typeof provider.load !== "function")
    throw new Error("Settings panel provider requires a load function");
  for (const action of definition.actions ?? [])
    if (typeof provider.actions?.[action.id] !== "function")
      throw new Error(
        `Settings panel provider is missing action "${action.id}"`,
      );
  for (const [id, handler] of Object.entries(provider.actions ?? {})) {
    if (typeof handler !== "function")
      throw new Error(`Settings panel action "${id}" must be a function`);
    if (!definition.actions?.some((action) => action.id === id))
      throw new Error(`Settings panel provider has undeclared action "${id}"`);
  }
}

const validateBinding = (
  value: SettingsPanelActionBinding,
  definition: InternalPanelDefinition,
  path: string,
): void => {
  const action = definition.actions?.find(({ id }) => id === value.actionId);
  if (!action) throw new SettingsPanelViewValidationError(`${path}.actionId`);
  const failures = validatePanelActionInput(
    value.params,
    action.params,
    `${path}.params`,
  );
  if (failures.length)
    throw new SettingsPanelViewValidationError(
      failures[0]?.path ?? `${path}.params`,
    );
};

const validateNode = (
  value: SettingsPanelNode | SettingsPanelRowNode,
  definition: InternalPanelDefinition,
  path: string,
): void => {
  if (value.kind !== "status" && value.kind !== "collection")
    validateBinding(value.action, definition, `${path}.action`);
  if (value.kind === "input") {
    try {
      validateRules(value.validation, `${path}.validation`);
    } catch {
      throw new SettingsPanelViewValidationError(`${path}.validation`);
    }
  }
  if (value.kind === "dialog") {
    const fieldIds = new Set<string>();
    for (const field of value.dialog.fields) {
      if (fieldIds.has(field.id))
        throw new SettingsPanelViewValidationError(
          `${path}.dialog.fields.${field.id}`,
        );
      fieldIds.add(field.id);
      try {
        validateRules(
          field.validation,
          `${path}.dialog.fields.${field.id}.validation`,
        );
      } catch {
        throw new SettingsPanelViewValidationError(
          `${path}.dialog.fields.${field.id}.validation`,
        );
      }
    }
  }
  if (value.kind === "collection") {
    const itemIds = new Set<string>();
    for (const item of value.items) {
      if (itemIds.has(item.id))
        throw new SettingsPanelViewValidationError(`${path}.items.${item.id}`);
      itemIds.add(item.id);
      const rowIds = new Set<string>();
      for (const child of item.nodes) {
        if (rowIds.has(child.id))
          throw new SettingsPanelViewValidationError(
            `${path}.items.${item.id}.nodes.${child.id}`,
          );
        rowIds.add(child.id);
        validateNode(
          child,
          definition,
          `${path}.items.${item.id}.nodes.${child.id}`,
        );
      }
    }
  }
};

export function cloneAndValidatePanelView(
  definition: InternalPanelDefinition,
  view: SettingsPanelView,
): SettingsPanelView {
  let cloned: SettingsPanelView;
  try {
    cloned = cloneRendererValue(view);
  } catch (error) {
    const path =
      error instanceof Error
        ? error.message.match(/ at value\.(.+)$/)?.[1]
        : undefined;
    throw new SettingsPanelViewValidationError(path ?? "view");
  }
  const parsed = v.safeParse(panelView, cloned);
  if (!parsed.success)
    throw new SettingsPanelViewValidationError(
      issuePath(parsed.issues) ?? "view",
    );
  const sectionIds = new Set<string>();
  for (const section of cloned.sections) {
    if (sectionIds.has(section.id))
      throw new SettingsPanelViewValidationError(`sections.${section.id}`);
    sectionIds.add(section.id);
    const nodeIds = new Set<string>();
    for (const child of section.nodes) {
      if (nodeIds.has(child.id))
        throw new SettingsPanelViewValidationError(
          `sections.${section.id}.nodes.${child.id}`,
        );
      nodeIds.add(child.id);
      validateNode(
        child,
        definition,
        `sections.${section.id}.nodes.${child.id}`,
      );
    }
  }
  return cloned;
}

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
  definition: NonNullable<InternalPanelDefinition["actions"]>[number],
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
  const parsed = v.safeParse(invocationCodec, cloned);
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
