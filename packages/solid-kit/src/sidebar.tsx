import { FiChevronLeft, FiMoreHorizontal } from "solid-icons/fi";
import {
  children,
  createEffect,
  createSignal,
  createUniqueId,
  type JSX,
  onCleanup,
  Show,
  splitProps,
} from "solid-js";

export interface SidebarProps extends JSX.HTMLAttributes<HTMLElement> {
  label: string;
  heading?: JSX.Element;
  footer?: JSX.Element;
  size?: "default" | "compact" | "wide";
  toggleLabels: { collapse: string; expand: string };
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  /** Automatically fold below this viewport width until the user toggles. Set 0 to disable. */
  collapseBelow?: number;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function Sidebar(props: SidebarProps) {
  const [local, rest] = splitProps(props, [
    "label",
    "heading",
    "footer",
    "size",
    "toggleLabels",
    "collapsed",
    "defaultCollapsed",
    "collapseBelow",
    "onCollapsedChange",
    "children",
    "class",
    "classList",
  ]);
  const [manualCollapsed, setManualCollapsed] = createSignal(
    local.defaultCollapsed,
  );
  const [narrow, setNarrow] = createSignal(false);
  const collapsed = () => local.collapsed ?? manualCollapsed() ?? narrow();
  const contentId = `eden-sidebar-${createUniqueId()}`;
  const footer = children(() => local.footer);
  const toggleLabel = () =>
    collapsed() ? local.toggleLabels.expand : local.toggleLabels.collapse;

  createEffect(() => {
    const breakpoint = local.collapseBelow ?? 760;
    if (
      breakpoint <= 0 ||
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      setNarrow(false);
      return;
    }
    const query = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    onCleanup(() => query.removeEventListener("change", update));
  });

  const toggle = () => {
    const next = !collapsed();
    setManualCollapsed(next);
    local.onCollapsedChange?.(next);
  };

  return (
    <aside
      {...rest}
      aria-label={local.label}
      class={`eden-sidebar ${local.class ?? ""}`}
      classList={{
        ...local.classList,
        "eden-sidebar-compact": local.size === "compact",
        "eden-sidebar-wide": local.size === "wide",
        "eden-sidebar-collapsed": collapsed(),
      }}
    >
      <div class="eden-sidebar-controls">
        <Show when={local.heading}>
          <span class="eden-sidebar-controls-title">{local.heading}</span>
        </Show>
        <button
          type="button"
          class="eden-btn eden-btn-ghost eden-btn-sm eden-btn-square eden-sidebar-toggle"
          aria-label={toggleLabel()}
          title={toggleLabel()}
          aria-expanded={!collapsed()}
          aria-controls={contentId}
          onClick={toggle}
        >
          <FiChevronLeft aria-hidden="true" />
        </button>
      </div>
      <div id={contentId} class="eden-sidebar-scroll eden-scrollbar">
        {local.children}
      </div>
      <Show when={footer()}>
        <div class="eden-sidebar-footer">{footer()}</div>
      </Show>
    </aside>
  );
}

export function SidebarSection(props: {
  title?: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <div class="eden-sidebar-section">
      <Show when={props.title}>
        <div class="eden-sidebar-section-title">{props.title}</div>
      </Show>
      <div class="eden-sidebar-items">{props.children}</div>
    </div>
  );
}

export function SidebarDivider() {
  return <hr class="eden-sidebar-divider" />;
}

export interface SidebarItemProps
  extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  label: string;
  icon: JSX.Element;
  description?: string;
  selected?: boolean;
  action?: JSX.Element;
}

export function SidebarItem(props: SidebarItemProps) {
  const [local, rest] = splitProps(props, [
    "label",
    "icon",
    "description",
    "selected",
    "action",
    "class",
    "classList",
    "aria-label",
    "title",
    "disabled",
  ]);
  return (
    <div
      class="eden-sidebar-row"
      classList={{ "eden-sidebar-row-with-action": Boolean(local.action) }}
    >
      <button
        type="button"
        {...rest}
        disabled={local.disabled}
        class={`eden-sidebar-item ${local.class ?? ""}`}
        classList={{
          ...local.classList,
          "eden-sidebar-item-selected": local.selected,
          "eden-sidebar-item-disabled": local.disabled,
        }}
        aria-label={local["aria-label"] ?? local.label}
        title={local.title ?? local.label}
      >
        <span class="eden-sidebar-item-icon" aria-hidden="true">
          {local.icon}
        </span>
        <Show
          when={local.description}
          fallback={<span class="eden-sidebar-item-text">{local.label}</span>}
        >
          <span class="eden-sidebar-item-details">
            <span class="eden-sidebar-item-title">{local.label}</span>
            <span class="eden-sidebar-item-subtitle">{local.description}</span>
          </span>
        </Show>
      </button>
      <Show when={local.action}>
        <div class="eden-sidebar-row-action">{local.action}</div>
      </Show>
    </div>
  );
}

export interface SidebarItemActionProps
  extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string;
}

export function SidebarItemAction(props: SidebarItemActionProps) {
  const [local, rest] = splitProps(props, ["children", "class", "title"]);
  return (
    <button
      type="button"
      {...rest}
      class={`eden-btn eden-btn-ghost eden-btn-sm eden-btn-square eden-sidebar-item-action ${local.class ?? ""}`}
      title={local.title ?? props["aria-label"]}
    >
      <span class="eden-sidebar-item-action-expanded">
        {local.children ?? <FiMoreHorizontal aria-hidden="true" />}
      </span>
      <span class="eden-sidebar-item-action-collapsed" aria-hidden="true" />
    </button>
  );
}
