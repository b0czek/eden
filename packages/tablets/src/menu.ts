import type { ContextMenuIconName } from "@edenapp/types";
import { type ContextMenuAction, contextMenu } from "./context-menu";

type MenuTitle = { __brand: "title"; text: string };
export type MenuElement =
  | ContextMenuAction
  | MenuTitle
  | null
  | undefined
  | false;

/** Menu title - will be extracted and used as the context menu title */
export const title = (text: string): MenuTitle => ({ __brand: "title", text });

/** Menu button */
export const button = (
  id: string,
  label: string,
  onSelect: () => void | Promise<void>,
  opts?: { icon?: ContextMenuIconName; danger?: boolean; disabled?: boolean },
): ContextMenuAction => ({ type: "item", id, label, onSelect, ...opts });

/** Menu separator */
export const separator = (): ContextMenuAction => ({ type: "separator" });

/** Conditional item - returns ifTrue when condition is true, ifFalse otherwise */
export const when = <T>(
  condition: boolean,
  ifTrue: T,
  ifFalse?: T,
): T | null => (condition ? ifTrue : (ifFalse ?? null));

/**
 * Create a menu factory from an array of elements.
 * Extracts title, filters nulls, returns { title, items } format.
 */
const buildMenu = <T>(
  factory: (data: T) => MenuElement[],
): ((data: T) => { title?: string; items: ContextMenuAction[] }) => {
  return (data: T) => {
    const elements = factory(data);
    const titleEl = elements.find(
      (el): el is MenuTitle =>
        el != null &&
        typeof el === "object" &&
        "__brand" in el &&
        el.__brand === "title",
    );
    const items = elements.filter(
      (el): el is ContextMenuAction =>
        el != null && typeof el === "object" && !("__brand" in el),
    );
    return { title: titleEl?.text, items };
  };
};

type Position = { left: number; top: number };

export interface Menu<T> {
  /** Show context menu with data */
  show(data: T, position?: Position): Promise<void>;
  /** Create event handler for onContextMenu */
  handler(data: T | (() => T)): (e: MouseEvent) => void;
  /** Get menu config (for advanced use) */
  build(data: T): { title?: string; items: ContextMenuAction[] };
}

/**
 * Create a menu object with .show() and .handler() methods.
 */
export const menu = <T>(factory: (data: T) => MenuElement[]): Menu<T> => {
  const build = buildMenu(factory);
  return {
    build,
    show: async (data, position) => {
      await contextMenu.open({ ...build(data), position });
    },
    handler: (data) => {
      const getData =
        typeof data === "function" ? (data as () => T) : () => data;
      return contextMenu.createHandler(() => build(getData()));
    },
  };
};
