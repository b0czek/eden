import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import { type ParentProps, splitProps, type ValidComponent } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { ButtonProps } from "./kobalte.js";
import { Button } from "./kobalte.js";
import {
  cn,
  type KitClassProps,
  type KitSizeProps,
  type KitToneProps,
} from "./shared.js";

type ElementProps<
  T extends ValidComponent,
  Extra extends object = object,
> = PolymorphicProps<T, ParentProps & KitClassProps & Extra>;

type PartProps = ParentProps & KitClassProps;

const part = (props: PartProps, baseClass: string, extraClass?: string) => {
  const [local, others] = splitProps(props, ["class", "children"]);
  return { local, others, class: cn(baseClass, extraClass, local.class) };
};

export type CardProps<T extends ValidComponent = "div"> = ElementProps<
  T,
  KitSizeProps & {
    variant?: "default" | "glass" | "elevated";
    interactive?: boolean;
  }
>;
const CardRoot = <T extends ValidComponent = "div">(props: CardProps<T>) => {
  const [local, others] = splitProps(props, [
    "as",
    "class",
    "children",
    "size",
    "variant",
    "interactive",
  ]);
  return (
    <Dynamic
      component={local.as ?? "div"}
      {...others}
      class={cn(
        "eden-card",
        local.variant && `eden-card-${local.variant}`,
        local.size && `eden-card-${local.size}`,
        local.interactive && "eden-card-interactive",
        local.class,
      )}
    >
      {local.children}
    </Dynamic>
  );
};
const CardHeader = (props: PartProps) => {
  const p = part(props, "eden-card-header");
  return (
    <div {...p.others} class={p.class}>
      {p.local.children}
    </div>
  );
};
const CardTitle = (props: PartProps) => {
  const p = part(props, "eden-card-title");
  return (
    <h3 {...p.others} class={p.class}>
      {p.local.children}
    </h3>
  );
};
const CardSubtitle = (props: PartProps) => {
  const p = part(props, "eden-card-subtitle");
  return (
    <p {...p.others} class={p.class}>
      {p.local.children}
    </p>
  );
};
const CardBody = (props: PartProps) => {
  const p = part(props, "eden-card-body");
  return (
    <div {...p.others} class={p.class}>
      {p.local.children}
    </div>
  );
};
const CardFooter = (props: PartProps) => {
  const p = part(props, "eden-card-footer");
  return (
    <div {...p.others} class={p.class}>
      {p.local.children}
    </div>
  );
};
const CardImage = (props: PartProps & { alt?: string }) => {
  const p = part(props, "eden-card-image");
  return <img {...p.others} alt={props.alt ?? ""} class={p.class} />;
};
export const Card = Object.assign(CardRoot, {
  Root: CardRoot,
  Header: CardHeader,
  Title: CardTitle,
  Subtitle: CardSubtitle,
  Body: CardBody,
  Footer: CardFooter,
  Image: CardImage,
});

const InfoCardRoot = <T extends ValidComponent = "div">(
  props: ElementProps<T>,
) => {
  const [local, others] = splitProps(props, ["as", "class", "children"]);
  return (
    <Dynamic
      component={local.as ?? "div"}
      {...others}
      class={cn("eden-info-card", local.class)}
    >
      {local.children}
    </Dynamic>
  );
};
const InfoCardIcon = (props: PartProps) => {
  const p = part(props, "eden-info-card-icon");
  return (
    <div {...p.others} class={p.class}>
      {p.local.children}
    </div>
  );
};
const InfoCardContent = (props: PartProps) => {
  const p = part(props, "eden-info-card-content");
  return (
    <div {...p.others} class={p.class}>
      {p.local.children}
    </div>
  );
};
const InfoCardTitle = (props: PartProps) => {
  const p = part(props, "eden-info-card-title");
  return (
    <h3 {...p.others} class={p.class}>
      {p.local.children}
    </h3>
  );
};
const InfoCardDescription = (props: PartProps) => {
  const p = part(props, "eden-info-card-description");
  return (
    <p {...p.others} class={p.class}>
      {p.local.children}
    </p>
  );
};
export const InfoCard = Object.assign(InfoCardRoot, {
  Root: InfoCardRoot,
  Icon: InfoCardIcon,
  Content: InfoCardContent,
  Title: InfoCardTitle,
  Description: InfoCardDescription,
});

const StatsCardRoot = <T extends ValidComponent = "div">(
  props: ElementProps<T>,
) => {
  const [local, others] = splitProps(props, ["as", "class", "children"]);
  return (
    <Dynamic
      component={local.as ?? "div"}
      {...others}
      class={cn("eden-stats-card", local.class)}
    >
      {local.children}
    </Dynamic>
  );
};
const StatsValue = (props: PartProps) => {
  const p = part(props, "eden-stats-value");
  return (
    <div {...p.others} class={p.class}>
      {p.local.children}
    </div>
  );
};
const StatsLabel = (props: PartProps) => {
  const p = part(props, "eden-stats-label");
  return (
    <div {...p.others} class={p.class}>
      {p.local.children}
    </div>
  );
};
export const StatsCard = Object.assign(StatsCardRoot, {
  Root: StatsCardRoot,
  Value: StatsValue,
  Label: StatsLabel,
});

export interface BadgeProps extends KitClassProps, KitSizeProps, KitToneProps {
  variant?:
    | "default"
    | "primary"
    | "secondary"
    | "success"
    | "danger"
    | "warning"
    | "info";
  dot?: boolean;
  animated?: boolean;
  children?: ParentProps["children"];
}
const BadgeRoot = (props: BadgeProps) => {
  const [local, others] = splitProps(props, [
    "class",
    "size",
    "tone",
    "variant",
    "dot",
    "animated",
    "children",
  ]);
  const variant = local.variant ?? local.tone;
  return (
    <span
      {...others}
      class={cn(
        "eden-badge",
        variant && `eden-badge-${variant}`,
        local.size && `eden-badge-${local.size}`,
        local.dot && "eden-badge-dot",
        local.animated && "eden-badge-dot-animated",
        local.class,
      )}
    >
      {local.children}
    </span>
  );
};
export const Badge = Object.assign(BadgeRoot, { Root: BadgeRoot });

const TagRoot = <T extends ValidComponent = "span">(
  props: ElementProps<T, { interactive?: boolean }>,
) => {
  const [local, others] = splitProps(props, [
    "as",
    "class",
    "children",
    "interactive",
  ]);
  return (
    <Dynamic
      component={local.as ?? "span"}
      {...others}
      class={cn(
        "eden-tag",
        local.interactive && "eden-interactive",
        local.class,
      )}
    >
      {local.children}
    </Dynamic>
  );
};
const TagClose = (props: PartProps) => {
  const p = part(props, "eden-tag-close");
  return (
    <button type="button" {...p.others} class={p.class} aria-label="Remove">
      {p.local.children ?? "×"}
    </button>
  );
};
const TagGroup = (props: PartProps) => {
  const p = part(props, "eden-tag-group");
  return (
    <div {...p.others} class={p.class}>
      {p.local.children}
    </div>
  );
};
export const Tag = Object.assign(TagRoot, {
  Root: TagRoot,
  Close: TagClose,
  Group: TagGroup,
});

export interface AvatarProps<T extends ValidComponent = "div">
  extends KitClassProps,
    KitSizeProps {
  as?: T;
  children?: ParentProps["children"];
}
const AvatarRoot = <T extends ValidComponent = "div">(
  props: AvatarProps<T>,
) => {
  const [local, others] = splitProps(props, [
    "as",
    "class",
    "children",
    "size",
  ]);
  return (
    <Dynamic
      component={local.as ?? "div"}
      {...others}
      class={cn(
        "eden-avatar",
        local.size && `eden-avatar-${local.size}`,
        local.class,
      )}
    >
      {local.children}
    </Dynamic>
  );
};
const AvatarImage = (props: PartProps & { alt?: string }) => {
  const p = part(props, "eden-avatar-img");
  return <img {...p.others} alt={props.alt ?? ""} class={p.class} />;
};
const AvatarFallback = (props: PartProps) => {
  const p = part(props, "eden-avatar-fallback");
  return (
    <span {...p.others} class={p.class}>
      {p.local.children}
    </span>
  );
};
const AvatarGroup = (props: PartProps) => {
  const p = part(props, "eden-avatar-group");
  return (
    <div {...p.others} class={p.class}>
      {p.local.children}
    </div>
  );
};
export const Avatar = Object.assign(AvatarRoot, {
  Root: AvatarRoot,
  Image: AvatarImage,
  Fallback: AvatarFallback,
  Group: AvatarGroup,
});

const ListRoot = <T extends ValidComponent = "div">(props: ElementProps<T>) => {
  const [local, others] = splitProps(props, ["as", "class", "children"]);
  return (
    <Dynamic
      component={local.as ?? "div"}
      {...others}
      class={cn("eden-list", local.class)}
    >
      {local.children}
    </Dynamic>
  );
};
const ListItem = <T extends ValidComponent = "div">(
  props: ElementProps<
    T,
    { active?: boolean; interactive?: boolean; disabled?: boolean }
  >,
) => {
  const [local, others] = splitProps(props, [
    "as",
    "class",
    "children",
    "active",
    "interactive",
    "disabled",
  ]);
  return (
    <Dynamic
      component={local.as ?? "div"}
      {...others}
      class={cn(
        "eden-list-item",
        local.active && "eden-list-item-active",
        local.interactive && "eden-list-item-interactive",
        local.disabled && "eden-list-item-disabled",
        local.class,
      )}
    >
      {local.children}
    </Dynamic>
  );
};
const ListIcon = (props: PartProps) => {
  const p = part(props, "eden-list-item-icon");
  return (
    <div {...p.others} class={p.class}>
      {p.local.children}
    </div>
  );
};
const ListContent = (props: PartProps) => {
  const p = part(props, "eden-list-item-content");
  return (
    <div {...p.others} class={p.class}>
      {p.local.children}
    </div>
  );
};
const ListTitle = (props: PartProps) => {
  const p = part(props, "eden-list-item-title");
  return (
    <div {...p.others} class={p.class}>
      {p.local.children}
    </div>
  );
};
const ListDescription = (props: PartProps) => {
  const p = part(props, "eden-list-item-description");
  return (
    <div {...p.others} class={p.class}>
      {p.local.children}
    </div>
  );
};
const ListMeta = (props: PartProps) => {
  const p = part(props, "eden-list-item-meta");
  return (
    <div {...p.others} class={p.class}>
      {p.local.children}
    </div>
  );
};
export const List = Object.assign(ListRoot, {
  Root: ListRoot,
  Item: ListItem,
  Icon: ListIcon,
  Content: ListContent,
  Title: ListTitle,
  Description: ListDescription,
  Meta: ListMeta,
});

const StepsRoot = <T extends ValidComponent = "div">(
  props: ElementProps<T>,
) => {
  const [local, others] = splitProps(props, ["as", "class", "children"]);
  return (
    <Dynamic
      component={local.as ?? "div"}
      {...others}
      class={cn("eden-steps", local.class)}
    >
      {local.children}
    </Dynamic>
  );
};
const Step = <T extends ValidComponent = "div">(
  props: ElementProps<T, { status?: "active" | "completed" }>,
) => {
  const [local, others] = splitProps(props, [
    "as",
    "class",
    "children",
    "status",
  ]);
  return (
    <Dynamic
      component={local.as ?? "div"}
      {...others}
      class={cn(
        "eden-step",
        local.status && `eden-step-${local.status}`,
        local.class,
      )}
    >
      {local.children}
    </Dynamic>
  );
};
const StepNumber = (props: PartProps) => {
  const p = part(props, "eden-step-number");
  return (
    <div {...p.others} class={p.class}>
      {p.local.children}
    </div>
  );
};
const StepLabel = (props: PartProps) => {
  const p = part(props, "eden-step-label");
  return (
    <div {...p.others} class={p.class}>
      {p.local.children}
    </div>
  );
};
export const Steps = Object.assign(StepsRoot, {
  Root: StepsRoot,
  Step,
  Number: StepNumber,
  Label: StepLabel,
});

const SidebarRoot = <T extends ValidComponent = "aside">(
  props: ElementProps<T, { size?: "compact" | "wide" }>,
) => {
  const [local, others] = splitProps(props, [
    "as",
    "class",
    "children",
    "size",
  ]);
  return (
    <Dynamic
      component={local.as ?? "aside"}
      {...others}
      class={cn(
        "eden-sidebar",
        local.size && `eden-sidebar-${local.size}`,
        local.class,
      )}
    >
      {local.children}
    </Dynamic>
  );
};
const SidebarHeader = (props: PartProps) => {
  const p = part(props, "eden-sidebar-header");
  return (
    <div {...p.others} class={p.class}>
      {p.local.children}
    </div>
  );
};
const SidebarSection = (props: PartProps) => {
  const p = part(props, "eden-sidebar-section");
  return (
    <section {...p.others} class={p.class}>
      {p.local.children}
    </section>
  );
};
const SidebarSectionTitle = (props: PartProps) => {
  const p = part(props, "eden-sidebar-section-title");
  return (
    <div {...p.others} class={p.class}>
      {p.local.children}
    </div>
  );
};
const SidebarDivider = (props: KitClassProps) => (
  <div {...props} class={cn("eden-sidebar-divider", props.class)} />
);
const SidebarItems = (props: PartProps) => {
  const p = part(props, "eden-sidebar-items");
  return (
    <div {...p.others} class={p.class}>
      {p.local.children}
    </div>
  );
};
const SidebarItem = <T extends ValidComponent = "button">(
  props: ElementProps<
    T,
    { selected?: boolean; disabled?: boolean; interactive?: boolean }
  >,
) => {
  const [local, others] = splitProps(props, [
    "as",
    "class",
    "children",
    "selected",
    "disabled",
    "interactive",
  ]);
  return (
    <Dynamic
      component={local.as ?? "button"}
      {...others}
      class={cn(
        "eden-sidebar-item",
        local.selected && "eden-sidebar-item-selected",
        local.disabled && "eden-sidebar-item-disabled",
        local.interactive !== false && "eden-interactive",
        local.class,
      )}
    >
      {local.children}
    </Dynamic>
  );
};
const SidebarItemIcon = (props: PartProps) => {
  const p = part(props, "eden-sidebar-item-icon");
  return (
    <div {...p.others} class={p.class}>
      {p.local.children}
    </div>
  );
};
const SidebarItemText = (props: PartProps) => {
  const p = part(props, "eden-sidebar-item-text");
  return (
    <span {...p.others} class={p.class}>
      {p.local.children}
    </span>
  );
};
const SidebarItemDetails = (props: PartProps) => {
  const p = part(props, "eden-sidebar-item-details");
  return (
    <div {...p.others} class={p.class}>
      {p.local.children}
    </div>
  );
};
const SidebarItemTitle = (props: PartProps) => {
  const p = part(props, "eden-sidebar-item-title");
  return (
    <span {...p.others} class={p.class}>
      {p.local.children}
    </span>
  );
};
const SidebarItemSubtitle = (props: PartProps) => {
  const p = part(props, "eden-sidebar-item-subtitle");
  return (
    <span {...p.others} class={p.class}>
      {p.local.children}
    </span>
  );
};
const SidebarItemMeta = (props: PartProps) => {
  const p = part(props, "eden-sidebar-item-meta");
  return (
    <span {...p.others} class={p.class}>
      {p.local.children}
    </span>
  );
};
const SidebarFooter = (props: PartProps) => {
  const p = part(props, "eden-sidebar-footer");
  return (
    <footer {...p.others} class={p.class}>
      {p.local.children}
    </footer>
  );
};
const SidebarSearch = (props: PartProps) => {
  const p = part(props, "eden-sidebar-search");
  return <input {...p.others} class={p.class} />;
};
export const Sidebar = Object.assign(SidebarRoot, {
  Root: SidebarRoot,
  Header: SidebarHeader,
  Section: SidebarSection,
  SectionTitle: SidebarSectionTitle,
  Divider: SidebarDivider,
  Items: SidebarItems,
  Item: SidebarItem,
  ItemIcon: SidebarItemIcon,
  ItemText: SidebarItemText,
  ItemDetails: SidebarItemDetails,
  ItemTitle: SidebarItemTitle,
  ItemSubtitle: SidebarItemSubtitle,
  ItemMeta: SidebarItemMeta,
  Footer: SidebarFooter,
  Search: SidebarSearch,
});

export interface AlertProps<T extends ValidComponent = "div">
  extends KitClassProps,
    KitToneProps {
  as?: T;
  variant?: "info" | "success" | "warning" | "danger";
  children?: ParentProps["children"];
}
const AlertRoot = <T extends ValidComponent = "div">(props: AlertProps<T>) => {
  const [local, others] = splitProps(props, [
    "as",
    "class",
    "children",
    "tone",
    "variant",
  ]);
  const tone =
    local.variant ?? (local.tone === "default" ? "info" : local.tone);
  return (
    <Dynamic
      component={local.as ?? "div"}
      {...others}
      role="alert"
      class={cn("eden-alert", tone && `eden-alert-${tone}`, local.class)}
    >
      {local.children}
    </Dynamic>
  );
};
const AlertTitle = (props: PartProps) => {
  const p = part(props, "eden-alert-title");
  return (
    <div {...p.others} class={p.class}>
      {p.local.children}
    </div>
  );
};
const AlertDescription = (props: PartProps) => {
  const p = part(props, "eden-alert-description");
  return (
    <div {...p.others} class={p.class}>
      {p.local.children}
    </div>
  );
};
export const Alert = Object.assign(AlertRoot, {
  Root: AlertRoot,
  Title: AlertTitle,
  Description: AlertDescription,
});

export interface SpinnerProps extends KitClassProps, KitSizeProps {
  label?: string;
}
export const Spinner = (props: SpinnerProps) => {
  const [local, others] = splitProps(props, ["class", "size", "label"]);
  return (
    <output
      {...others}
      class={cn(
        "eden-spinner",
        local.size && `eden-spinner-${local.size}`,
        local.class,
      )}
      aria-label={local.label}
    />
  );
};

export interface SkeletonProps<T extends ValidComponent = "div">
  extends KitClassProps,
    KitSizeProps {
  as?: T;
  variant?: "default" | "text" | "title" | "avatar" | "button";
  children?: ParentProps["children"];
}
export const Skeleton = <T extends ValidComponent = "div">(
  props: SkeletonProps<T>,
) => {
  const [local, others] = splitProps(props, [
    "as",
    "class",
    "children",
    "size",
    "variant",
  ]);
  return (
    <Dynamic
      component={local.as ?? "div"}
      {...others}
      class={cn(
        "eden-skeleton",
        local.variant && `eden-skeleton-${local.variant}`,
        local.size && `eden-skeleton-${local.size}`,
        local.class,
      )}
    >
      {local.children}
    </Dynamic>
  );
};

export interface ButtonGroupProps<T extends ValidComponent = "div">
  extends KitClassProps {
  as?: T;
  orientation?: "horizontal" | "vertical";
  children?: ParentProps["children"];
}
export const ButtonGroup = <T extends ValidComponent = "div">(
  props: ButtonGroupProps<T>,
) => {
  const [local, others] = splitProps(props, [
    "as",
    "class",
    "children",
    "orientation",
  ]);
  return (
    <Dynamic
      component={local.as ?? "div"}
      {...others}
      class={cn(
        "eden-btn-group",
        local.orientation === "vertical" && "eden-btn-group-vertical",
        local.class,
      )}
    >
      {local.children}
    </Dynamic>
  );
};

export interface FABProps<T extends ValidComponent = "button">
  extends KitClassProps,
    KitSizeProps {
  as?: T;
  children?: ParentProps["children"];
}
export const FAB = <T extends ValidComponent = "button">(
  props: FABProps<T>,
) => {
  const [local, others] = splitProps(props, [
    "as",
    "class",
    "children",
    "size",
  ]);
  return (
    <Dynamic
      component={local.as ?? "button"}
      {...others}
      class={cn(
        "eden-fab",
        local.size && `eden-fab-${local.size}`,
        local.class,
      )}
    >
      {local.children}
    </Dynamic>
  );
};
export const Fab = FAB;

export interface IconButtonProps extends Omit<ButtonProps, "shape"> {
  shape?: "square" | "pill";
}
export const IconButton = (props: IconButtonProps) => (
  <Button
    {...props}
    shape={props.shape ?? "square"}
    class={cn("eden-btn-icon", props.class)}
  />
);
