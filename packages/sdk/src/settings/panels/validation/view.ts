import type {
  SettingsPanelActionBinding,
  SettingsPanelDefinition,
  SettingsPanelNode,
  SettingsPanelRowNode,
  SettingsPanelView,
} from "@edenapp/types";
import * as v from "valibot";
import { SettingsPanelViewValidationError } from "../errors";
import { cloneRendererValue } from "../serialization";
import { validatePanelActionInput } from "./actions";
import {
  finite,
  issuePath,
  itemId,
  jsonValue,
  localized,
  validateRules,
  validation,
} from "./primitives";

function invalidPanelView(path: string): SettingsPanelViewValidationError {
  return new SettingsPanelViewValidationError({ path });
}

const badge = v.strictObject({
  label: localized,
  tone: v.optional(
    v.picklist(["neutral", "info", "success", "warning", "danger"]),
  ),
});

const option = v.strictObject({
  value: v.string(),
  label: localized,
  description: v.optional(localized),
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

const validateBinding = (
  value: SettingsPanelActionBinding,
  definition: SettingsPanelDefinition,
  path: string,
): void => {
  const action = definition.actions?.find(({ id }) => id === value.actionId);
  if (!action) throw invalidPanelView(`${path}.actionId`);
  const failures = validatePanelActionInput(
    value.params,
    action.params,
    `${path}.params`,
  );
  if (failures.length)
    throw invalidPanelView(failures[0]?.path ?? `${path}.params`);
};

const validateNode = (
  value: SettingsPanelNode | SettingsPanelRowNode,
  definition: SettingsPanelDefinition,
  path: string,
): void => {
  if (value.kind !== "status" && value.kind !== "collection")
    validateBinding(value.action, definition, `${path}.action`);
  if (value.kind === "input") {
    try {
      validateRules(value.validation, `${path}.validation`);
    } catch {
      throw invalidPanelView(`${path}.validation`);
    }
  }
  if (value.kind === "dialog") {
    const fieldIds = new Set<string>();
    for (const field of value.dialog.fields) {
      if (fieldIds.has(field.id))
        throw invalidPanelView(`${path}.dialog.fields.${field.id}`);
      fieldIds.add(field.id);
      try {
        validateRules(
          field.validation,
          `${path}.dialog.fields.${field.id}.validation`,
        );
      } catch {
        throw invalidPanelView(`${path}.dialog.fields.${field.id}.validation`);
      }
    }
  }
  if (value.kind === "collection") {
    const itemIds = new Set<string>();
    for (const item of value.items) {
      if (itemIds.has(item.id))
        throw invalidPanelView(`${path}.items.${item.id}`);
      itemIds.add(item.id);
      const rowIds = new Set<string>();
      for (const child of item.nodes) {
        if (rowIds.has(child.id))
          throw invalidPanelView(`${path}.items.${item.id}.nodes.${child.id}`);
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
  definition: SettingsPanelDefinition,
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
    throw invalidPanelView(path ?? "view");
  }
  const parsed = v.safeParse(panelView, cloned);
  if (!parsed.success)
    throw invalidPanelView(issuePath(parsed.issues) ?? "view");
  const sectionIds = new Set<string>();
  for (const section of cloned.sections) {
    if (sectionIds.has(section.id))
      throw invalidPanelView(`sections.${section.id}`);
    sectionIds.add(section.id);
    const nodeIds = new Set<string>();
    for (const child of section.nodes) {
      if (nodeIds.has(child.id))
        throw invalidPanelView(`sections.${section.id}.nodes.${child.id}`);
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
