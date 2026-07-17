import type { JSX, ParentProps, ValidComponent } from "solid-js";
import { Dynamic } from "solid-js/web";

export const cn = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

export interface KitClassProps {
  class?: string;
}

export interface KitSizeProps {
  size?: "xs" | "sm" | "md" | "lg" | "xl";
}

export interface KitToneProps {
  tone?:
    | "default"
    | "primary"
    | "secondary"
    | "success"
    | "danger"
    | "warning"
    | "info";
}

export interface KitVariantProps {
  variant?: string;
}

export type SemanticProps<T extends ValidComponent = "div"> = ParentProps &
  KitClassProps & {
    as?: T;
  };

export const Semantic = <T extends ValidComponent = "div">(
  props: SemanticProps<T>,
  baseClass: string,
  extraClass?: string,
) => {
  const { as, class: className, ...others } = props;
  return (
    <Dynamic
      component={as ?? "div"}
      {...others}
      class={cn(baseClass, extraClass, className)}
    />
  );
};

export type KitEventHandler<T extends Event = Event> = JSX.EventHandlerUnion<
  HTMLElement,
  T
>;
