import { AlertDialog as KAlertDialog } from "@kobalte/core/alert-dialog";
import { Button as KButton } from "@kobalte/core/button";
import { Checkbox as KCheckbox } from "@kobalte/core/checkbox";
import { Dialog as KDialog } from "@kobalte/core/dialog";
import { Popover as KPopover } from "@kobalte/core/popover";
import { Progress as KProgress } from "@kobalte/core/progress";
import { RadioGroup as KRadioGroup } from "@kobalte/core/radio-group";
import { Select as KSelect } from "@kobalte/core/select";
import { Slider as KSlider } from "@kobalte/core/slider";
import { Switch as KSwitch } from "@kobalte/core/switch";
import { Tabs as KTabs } from "@kobalte/core/tabs";
import { TextField as KTextField } from "@kobalte/core/text-field";
import { Tooltip as KTooltip } from "@kobalte/core/tooltip";
import { type ComponentProps, splitProps } from "solid-js";
import {
  cn,
  type KitClassProps,
  type KitSizeProps,
  type KitToneProps,
} from "./shared.js";

type Classed<P> = P & KitClassProps;

const classed = <P extends KitClassProps>(
  props: P,
  baseClass: string,
  extraClass?: string,
) => cn(baseClass, extraClass, props.class);

export type ButtonProps = Classed<
  ComponentProps<typeof KButton> &
    KitSizeProps &
    KitToneProps & {
      variant?:
        | "default"
        | "primary"
        | "secondary"
        | "success"
        | "danger"
        | "ghost"
        | "outline";
      shape?: "square" | "pill";
    }
>;

export const Button = (props: ButtonProps) => {
  const [local, variants] = splitProps(props, [
    "class",
    "variant",
    "tone",
    "size",
    "shape",
  ]);
  const variant = local.variant ?? local.tone;
  return (
    <KButton
      {...variants}
      class={classed(
        local,
        "eden-btn",
        cn(
          variant && `eden-btn-${variant}`,
          local.size && `eden-btn-${local.size}`,
          local.shape && `eden-btn-${local.shape}`,
        ),
      )}
    />
  );
};

const TextFieldRoot = (
  props: Classed<ComponentProps<typeof KTextField>> & KitSizeProps,
) => {
  const [local, others] = splitProps(props, ["class", "size"]);
  return (
    <KTextField
      {...others}
      class={classed(
        local,
        "eden-text-field",
        local.size && `eden-text-field-${local.size}`,
      )}
    />
  );
};
const TextFieldInput = (
  props: Classed<ComponentProps<typeof KTextField.Input>> & KitSizeProps,
) => {
  const [local, others] = splitProps(props, ["class", "size"]);
  return (
    <KTextField.Input
      {...others}
      class={classed(
        local,
        "eden-input",
        local.size && `eden-input-${local.size}`,
      )}
    />
  );
};
const TextFieldTextArea = (
  props: Classed<ComponentProps<typeof KTextField.TextArea>> & KitSizeProps,
) => {
  const [local, others] = splitProps(props, ["class", "size"]);
  return (
    <KTextField.TextArea
      {...others}
      class={classed(
        local,
        "eden-textarea",
        local.size && `eden-input-${local.size}`,
      )}
    />
  );
};
const TextFieldLabel = (
  props: Classed<ComponentProps<typeof KTextField.Label>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KTextField.Label {...others} class={classed(local, "eden-form-label")} />
  );
};
const TextFieldDescription = (
  props: Classed<ComponentProps<typeof KTextField.Description>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KTextField.Description
      {...others}
      class={classed(local, "eden-form-help")}
    />
  );
};
const TextFieldErrorMessage = (
  props: Classed<ComponentProps<typeof KTextField.ErrorMessage>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KTextField.ErrorMessage
      {...others}
      class={classed(local, "eden-form-error")}
    />
  );
};
export const TextField = Object.assign(TextFieldRoot, {
  Root: TextFieldRoot,
  Input: TextFieldInput,
  TextArea: TextFieldTextArea,
  Label: TextFieldLabel,
  Description: TextFieldDescription,
  ErrorMessage: TextFieldErrorMessage,
});

const SelectRoot = (
  props: Classed<ComponentProps<typeof KSelect>> & KitSizeProps,
) => {
  const [local, others] = splitProps(props, ["class", "size"]);
  return (
    <KSelect
      {...others}
      class={classed(
        local,
        "eden-select-root",
        local.size && `eden-select-${local.size}`,
      )}
    />
  );
};
const SelectLabel = (props: Classed<ComponentProps<typeof KSelect.Label>>) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSelect.Label {...others} class={classed(local, "eden-form-label")} />
  );
};
const SelectTrigger = (
  props: Classed<ComponentProps<typeof KSelect.Trigger>> & KitSizeProps,
) => {
  const [local, others] = splitProps(props, ["class", "size"]);
  return (
    <KSelect.Trigger
      {...others}
      class={classed(
        local,
        "eden-select",
        local.size && `eden-select-${local.size}`,
      )}
    />
  );
};
const SelectValue = (props: Classed<ComponentProps<typeof KSelect.Value>>) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSelect.Value {...others} class={classed(local, "eden-select-value")} />
  );
};
const SelectIcon = (props: Classed<ComponentProps<typeof KSelect.Icon>>) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSelect.Icon {...others} class={classed(local, "eden-select-icon")} />
  );
};
const SelectPortal = KSelect.Portal;
const SelectContent = (
  props: Classed<ComponentProps<typeof KSelect.Content>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSelect.Content
      {...others}
      class={classed(local, "eden-select-content")}
    />
  );
};
const SelectListbox = (
  props: Classed<ComponentProps<typeof KSelect.Listbox>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSelect.Listbox
      {...others}
      class={classed(local, "eden-select-listbox")}
    />
  );
};
const SelectItem = (props: Classed<ComponentProps<typeof KSelect.Item>>) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSelect.Item {...others} class={classed(local, "eden-select-item")} />
  );
};
const SelectItemLabel = (
  props: Classed<ComponentProps<typeof KSelect.ItemLabel>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSelect.ItemLabel
      {...others}
      class={classed(local, "eden-select-item-label")}
    />
  );
};
const SelectItemDescription = (
  props: Classed<ComponentProps<typeof KSelect.ItemDescription>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSelect.ItemDescription
      {...others}
      class={classed(local, "eden-select-item-description")}
    />
  );
};
const SelectItemIndicator = (
  props: Classed<ComponentProps<typeof KSelect.ItemIndicator>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSelect.ItemIndicator
      {...others}
      class={classed(local, "eden-select-item-indicator")}
    />
  );
};
const SelectSection = (
  props: Classed<ComponentProps<typeof KSelect.Section>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSelect.Section
      {...others}
      class={classed(local, "eden-select-section")}
    />
  );
};
const SelectArrow = (props: Classed<ComponentProps<typeof KSelect.Arrow>>) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSelect.Arrow {...others} class={classed(local, "eden-select-arrow")} />
  );
};
const SelectHiddenSelect = KSelect.HiddenSelect;
const SelectDescription = (
  props: Classed<ComponentProps<typeof KSelect.Description>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSelect.Description {...others} class={classed(local, "eden-form-help")} />
  );
};
const SelectErrorMessage = (
  props: Classed<ComponentProps<typeof KSelect.ErrorMessage>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSelect.ErrorMessage
      {...others}
      class={classed(local, "eden-form-error")}
    />
  );
};
export const Select = Object.assign(SelectRoot, {
  Root: SelectRoot,
  Label: SelectLabel,
  Trigger: SelectTrigger,
  Value: SelectValue,
  Icon: SelectIcon,
  Portal: SelectPortal,
  Content: SelectContent,
  Listbox: SelectListbox,
  Item: SelectItem,
  ItemLabel: SelectItemLabel,
  ItemDescription: SelectItemDescription,
  ItemIndicator: SelectItemIndicator,
  Section: SelectSection,
  Arrow: SelectArrow,
  HiddenSelect: SelectHiddenSelect,
  Description: SelectDescription,
  ErrorMessage: SelectErrorMessage,
});

const CheckboxRoot = (props: Classed<ComponentProps<typeof KCheckbox>>) => {
  const [local, others] = splitProps(props, ["class"]);
  return <KCheckbox {...others} class={classed(local, "eden-checkbox-root")} />;
};
const CheckboxControl = (
  props: Classed<ComponentProps<typeof KCheckbox.Control>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KCheckbox.Control
      {...others}
      class={classed(local, "eden-checkbox-control")}
    />
  );
};
const CheckboxIndicator = (
  props: Classed<ComponentProps<typeof KCheckbox.Indicator>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KCheckbox.Indicator
      {...others}
      class={classed(local, "eden-checkbox-indicator")}
    />
  );
};
const CheckboxInput = (
  props: Classed<ComponentProps<typeof KCheckbox.Input>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KCheckbox.Input
      {...others}
      class={classed(local, "eden-checkbox-input")}
    />
  );
};
const CheckboxLabel = (
  props: Classed<ComponentProps<typeof KCheckbox.Label>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KCheckbox.Label {...others} class={classed(local, "eden-form-label")} />
  );
};
const CheckboxDescription = (
  props: Classed<ComponentProps<typeof KCheckbox.Description>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KCheckbox.Description
      {...others}
      class={classed(local, "eden-form-help")}
    />
  );
};
const CheckboxErrorMessage = (
  props: Classed<ComponentProps<typeof KCheckbox.ErrorMessage>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KCheckbox.ErrorMessage
      {...others}
      class={classed(local, "eden-form-error")}
    />
  );
};
export const Checkbox = Object.assign(CheckboxRoot, {
  Root: CheckboxRoot,
  Control: CheckboxControl,
  Indicator: CheckboxIndicator,
  Input: CheckboxInput,
  Label: CheckboxLabel,
  Description: CheckboxDescription,
  ErrorMessage: CheckboxErrorMessage,
});

const SwitchRoot = (props: Classed<ComponentProps<typeof KSwitch>>) => {
  const [local, others] = splitProps(props, ["class"]);
  return <KSwitch {...others} class={classed(local, "eden-switch")} />;
};
const SwitchControl = (
  props: Classed<ComponentProps<typeof KSwitch.Control>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSwitch.Control
      {...others}
      class={classed(local, "eden-switch-control")}
    />
  );
};
const SwitchThumb = (props: Classed<ComponentProps<typeof KSwitch.Thumb>>) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSwitch.Thumb {...others} class={classed(local, "eden-switch-thumb")} />
  );
};
const SwitchInput = (props: Classed<ComponentProps<typeof KSwitch.Input>>) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSwitch.Input {...others} class={classed(local, "eden-switch-input")} />
  );
};
const SwitchLabel = (props: Classed<ComponentProps<typeof KSwitch.Label>>) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSwitch.Label {...others} class={classed(local, "eden-form-label")} />
  );
};
const SwitchDescription = (
  props: Classed<ComponentProps<typeof KSwitch.Description>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSwitch.Description {...others} class={classed(local, "eden-form-help")} />
  );
};
const SwitchErrorMessage = (
  props: Classed<ComponentProps<typeof KSwitch.ErrorMessage>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSwitch.ErrorMessage
      {...others}
      class={classed(local, "eden-form-error")}
    />
  );
};
export const Switch = Object.assign(SwitchRoot, {
  Root: SwitchRoot,
  Control: SwitchControl,
  Thumb: SwitchThumb,
  Input: SwitchInput,
  Label: SwitchLabel,
  Description: SwitchDescription,
  ErrorMessage: SwitchErrorMessage,
});

const RadioGroupRoot = (
  props: Classed<ComponentProps<typeof KRadioGroup>> & {
    orientation?: "horizontal" | "vertical";
  },
) => {
  const [local, others] = splitProps(props, ["class", "orientation"]);
  return (
    <KRadioGroup
      {...others}
      orientation={local.orientation}
      class={classed(
        local,
        "eden-radio-group",
        local.orientation && `eden-radio-group-${local.orientation}`,
      )}
    />
  );
};
const RadioGroupLabel = (
  props: Classed<ComponentProps<typeof KRadioGroup.Label>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KRadioGroup.Label {...others} class={classed(local, "eden-form-label")} />
  );
};
const RadioGroupItem = (
  props: Classed<ComponentProps<typeof KRadioGroup.Item>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KRadioGroup.Item {...others} class={classed(local, "eden-radio-option")} />
  );
};
const RadioGroupItemControl = (
  props: Classed<ComponentProps<typeof KRadioGroup.ItemControl>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KRadioGroup.ItemControl
      {...others}
      class={classed(local, "eden-radio-control")}
    />
  );
};
const RadioGroupItemIndicator = (
  props: Classed<ComponentProps<typeof KRadioGroup.ItemIndicator>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KRadioGroup.ItemIndicator
      {...others}
      class={classed(local, "eden-radio-indicator")}
    />
  );
};
const RadioGroupItemInput = (
  props: Classed<ComponentProps<typeof KRadioGroup.ItemInput>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KRadioGroup.ItemInput
      {...others}
      class={classed(local, "eden-radio-input")}
    />
  );
};
const RadioGroupItemLabel = (
  props: Classed<ComponentProps<typeof KRadioGroup.ItemLabel>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KRadioGroup.ItemLabel
      {...others}
      class={classed(local, "eden-radio-option-label")}
    />
  );
};
const RadioGroupItemDescription = (
  props: Classed<ComponentProps<typeof KRadioGroup.ItemDescription>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KRadioGroup.ItemDescription
      {...others}
      class={classed(local, "eden-form-help")}
    />
  );
};
const RadioGroupDescription = (
  props: Classed<ComponentProps<typeof KRadioGroup.Description>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KRadioGroup.Description
      {...others}
      class={classed(local, "eden-form-help")}
    />
  );
};
const RadioGroupErrorMessage = (
  props: Classed<ComponentProps<typeof KRadioGroup.ErrorMessage>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KRadioGroup.ErrorMessage
      {...others}
      class={classed(local, "eden-form-error")}
    />
  );
};
export const RadioGroup = Object.assign(RadioGroupRoot, {
  Root: RadioGroupRoot,
  Label: RadioGroupLabel,
  Item: RadioGroupItem,
  ItemControl: RadioGroupItemControl,
  ItemIndicator: RadioGroupItemIndicator,
  ItemInput: RadioGroupItemInput,
  ItemLabel: RadioGroupItemLabel,
  ItemDescription: RadioGroupItemDescription,
  Description: RadioGroupDescription,
  ErrorMessage: RadioGroupErrorMessage,
});

const SliderRoot = (
  props: Classed<ComponentProps<typeof KSlider>> & {
    orientation?: "horizontal" | "vertical";
  },
) => {
  const [local, others] = splitProps(props, ["class", "orientation"]);
  return (
    <KSlider
      {...others}
      orientation={local.orientation}
      class={classed(
        local,
        "eden-slider",
        local.orientation && `eden-slider-${local.orientation}`,
      )}
    />
  );
};
const SliderLabel = (props: Classed<ComponentProps<typeof KSlider.Label>>) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSlider.Label {...others} class={classed(local, "eden-form-label")} />
  );
};
const SliderTrack = (props: Classed<ComponentProps<typeof KSlider.Track>>) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSlider.Track {...others} class={classed(local, "eden-slider-track")} />
  );
};
const SliderFill = (props: Classed<ComponentProps<typeof KSlider.Fill>>) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSlider.Fill {...others} class={classed(local, "eden-slider-fill")} />
  );
};
const SliderThumb = (props: Classed<ComponentProps<typeof KSlider.Thumb>>) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSlider.Thumb {...others} class={classed(local, "eden-slider-thumb")} />
  );
};
const SliderInput = (props: Classed<ComponentProps<typeof KSlider.Input>>) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSlider.Input {...others} class={classed(local, "eden-slider-input")} />
  );
};
const SliderDescription = (
  props: Classed<ComponentProps<typeof KSlider.Description>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSlider.Description {...others} class={classed(local, "eden-form-help")} />
  );
};
const SliderErrorMessage = (
  props: Classed<ComponentProps<typeof KSlider.ErrorMessage>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KSlider.ErrorMessage
      {...others}
      class={classed(local, "eden-form-error")}
    />
  );
};
export const Slider = Object.assign(SliderRoot, {
  Root: SliderRoot,
  Label: SliderLabel,
  Track: SliderTrack,
  Fill: SliderFill,
  Thumb: SliderThumb,
  Input: SliderInput,
  Description: SliderDescription,
  ErrorMessage: SliderErrorMessage,
});

const TabsRoot = (
  props: Classed<ComponentProps<typeof KTabs>> & {
    orientation?: "horizontal" | "vertical";
  },
) => {
  const [local, others] = splitProps(props, ["class", "orientation"]);
  return (
    <KTabs
      {...others}
      orientation={local.orientation}
      class={classed(
        local,
        "eden-tabs",
        local.orientation === "vertical" ? "eden-tabs-vertical" : undefined,
      )}
    />
  );
};
const TabsList = (props: Classed<ComponentProps<typeof KTabs.List>>) => {
  const [local, others] = splitProps(props, ["class"]);
  return <KTabs.List {...others} class={classed(local, "eden-tab-list")} />;
};
const TabsTrigger = (props: Classed<ComponentProps<typeof KTabs.Trigger>>) => {
  const [local, others] = splitProps(props, ["class"]);
  return <KTabs.Trigger {...others} class={classed(local, "eden-tab")} />;
};
const TabsContent = (props: Classed<ComponentProps<typeof KTabs.Content>>) => {
  const [local, others] = splitProps(props, ["class"]);
  return <KTabs.Content {...others} class={classed(local, "eden-tab-panel")} />;
};
const TabsIndicator = (
  props: Classed<ComponentProps<typeof KTabs.Indicator>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KTabs.Indicator {...others} class={classed(local, "eden-tab-indicator")} />
  );
};
export const Tabs = Object.assign(TabsRoot, {
  Root: TabsRoot,
  List: TabsList,
  Trigger: TabsTrigger,
  Content: TabsContent,
  Indicator: TabsIndicator,
});

const DialogRoot = (
  props: Classed<ComponentProps<typeof KDialog>> & {
    size?: "sm" | "md" | "lg";
  },
) => {
  const [, others] = splitProps(props, ["class", "size"]);
  return <KDialog {...others} />;
};
const DialogTrigger = (
  props: Classed<ComponentProps<typeof KDialog.Trigger>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return <KDialog.Trigger {...others} class={classed(local, "eden-btn")} />;
};
const DialogPortal = KDialog.Portal;
const DialogOverlay = (
  props: Classed<ComponentProps<typeof KDialog.Overlay>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KDialog.Overlay {...others} class={classed(local, "eden-modal-overlay")} />
  );
};
const DialogContent = (
  props: Classed<ComponentProps<typeof KDialog.Content>> & {
    size?: "sm" | "md" | "lg";
  },
) => {
  const [local, others] = splitProps(props, ["class", "size"]);
  return (
    <KDialog.Content
      {...others}
      role="dialog"
      class={classed(
        local,
        "eden-modal",
        local.size && `eden-modal-${local.size}`,
      )}
    />
  );
};
const DialogCloseButton = (
  props: Classed<ComponentProps<typeof KDialog.CloseButton>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KDialog.CloseButton
      {...others}
      class={classed(local, "eden-modal-close")}
    />
  );
};
const DialogTitle = (props: Classed<ComponentProps<typeof KDialog.Title>>) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KDialog.Title {...others} class={classed(local, "eden-modal-title")} />
  );
};
const DialogDescription = (
  props: Classed<ComponentProps<typeof KDialog.Description>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KDialog.Description
      {...others}
      class={classed(local, "eden-modal-description")}
    />
  );
};
export const Dialog = Object.assign(DialogRoot, {
  Root: DialogRoot,
  Trigger: DialogTrigger,
  Portal: DialogPortal,
  Overlay: DialogOverlay,
  Content: DialogContent,
  CloseButton: DialogCloseButton,
  Title: DialogTitle,
  Description: DialogDescription,
});

const AlertDialogRoot = (
  props: Classed<ComponentProps<typeof KAlertDialog>>,
) => {
  const [, others] = splitProps(props, ["class"]);
  return <KAlertDialog {...others} />;
};
const AlertDialogTrigger = (
  props: Classed<ComponentProps<typeof KAlertDialog.Trigger>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KAlertDialog.Trigger {...others} class={classed(local, "eden-btn")} />
  );
};
const AlertDialogPortal = KAlertDialog.Portal;
const AlertDialogOverlay = (
  props: Classed<ComponentProps<typeof KAlertDialog.Overlay>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KAlertDialog.Overlay
      {...others}
      class={classed(local, "eden-modal-overlay")}
    />
  );
};
const AlertDialogContent = (
  props: Classed<ComponentProps<typeof KAlertDialog.Content>> & {
    size?: "sm" | "md" | "lg";
  },
) => {
  const [local, others] = splitProps(props, ["class", "size"]);
  return (
    <KAlertDialog.Content
      {...others}
      role="alertdialog"
      class={classed(
        local,
        "eden-modal",
        local.size && `eden-modal-${local.size}`,
      )}
    />
  );
};
const AlertDialogCloseButton = (
  props: Classed<ComponentProps<typeof KAlertDialog.CloseButton>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KAlertDialog.CloseButton
      {...others}
      class={classed(local, "eden-modal-close")}
    />
  );
};
const AlertDialogTitle = (
  props: Classed<ComponentProps<typeof KAlertDialog.Title>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KAlertDialog.Title
      {...others}
      class={classed(local, "eden-modal-title")}
    />
  );
};
const AlertDialogDescription = (
  props: Classed<ComponentProps<typeof KAlertDialog.Description>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KAlertDialog.Description
      {...others}
      class={classed(local, "eden-modal-description")}
    />
  );
};
export const AlertDialog = Object.assign(AlertDialogRoot, {
  Root: AlertDialogRoot,
  Trigger: AlertDialogTrigger,
  Portal: AlertDialogPortal,
  Overlay: AlertDialogOverlay,
  Content: AlertDialogContent,
  CloseButton: AlertDialogCloseButton,
  Title: AlertDialogTitle,
  Description: AlertDialogDescription,
});

const TooltipRoot = (props: Classed<ComponentProps<typeof KTooltip>>) => {
  const [, others] = splitProps(props, ["class"]);
  return <KTooltip {...others} />;
};
const TooltipTrigger = (
  props: Classed<ComponentProps<typeof KTooltip.Trigger>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KTooltip.Trigger
      {...others}
      class={classed(local, "eden-tooltip-trigger")}
    />
  );
};
const TooltipPortal = KTooltip.Portal;
const TooltipContent = (
  props: Classed<ComponentProps<typeof KTooltip.Content>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KTooltip.Content {...others} class={classed(local, "eden-tooltip")} />
  );
};
const TooltipArrow = (
  props: Classed<ComponentProps<typeof KTooltip.Arrow>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KTooltip.Arrow {...others} class={classed(local, "eden-tooltip-arrow")} />
  );
};
export const Tooltip = Object.assign(TooltipRoot, {
  Root: TooltipRoot,
  Trigger: TooltipTrigger,
  Portal: TooltipPortal,
  Content: TooltipContent,
  Arrow: TooltipArrow,
});

const PopoverRoot = (props: Classed<ComponentProps<typeof KPopover>>) => {
  const [, others] = splitProps(props, ["class"]);
  return <KPopover {...others} />;
};
const PopoverAnchor = (
  props: Classed<ComponentProps<typeof KPopover.Anchor>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KPopover.Anchor
      {...others}
      class={classed(local, "eden-popover-anchor")}
    />
  );
};
const PopoverTrigger = (
  props: Classed<ComponentProps<typeof KPopover.Trigger>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return <KPopover.Trigger {...others} class={classed(local, "eden-btn")} />;
};
const PopoverPortal = KPopover.Portal;
const PopoverContent = (
  props: Classed<ComponentProps<typeof KPopover.Content>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KPopover.Content {...others} class={classed(local, "eden-popover")} />
  );
};
const PopoverCloseButton = (
  props: Classed<ComponentProps<typeof KPopover.CloseButton>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KPopover.CloseButton
      {...others}
      class={classed(local, "eden-modal-close")}
    />
  );
};
const PopoverTitle = (
  props: Classed<ComponentProps<typeof KPopover.Title>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KPopover.Title {...others} class={classed(local, "eden-popover-title")} />
  );
};
const PopoverDescription = (
  props: Classed<ComponentProps<typeof KPopover.Description>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KPopover.Description
      {...others}
      class={classed(local, "eden-popover-content")}
    />
  );
};
const PopoverArrow = (
  props: Classed<ComponentProps<typeof KPopover.Arrow>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KPopover.Arrow {...others} class={classed(local, "eden-popover-arrow")} />
  );
};
export const Popover = Object.assign(PopoverRoot, {
  Root: PopoverRoot,
  Anchor: PopoverAnchor,
  Trigger: PopoverTrigger,
  Portal: PopoverPortal,
  Content: PopoverContent,
  CloseButton: PopoverCloseButton,
  Title: PopoverTitle,
  Description: PopoverDescription,
  Arrow: PopoverArrow,
});

const ProgressRoot = (props: Classed<ComponentProps<typeof KProgress>>) => {
  const [local, others] = splitProps(props, ["class"]);
  return <KProgress {...others} class={classed(local, "eden-progress")} />;
};
const ProgressTrack = (
  props: Classed<ComponentProps<typeof KProgress.Track>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KProgress.Track
      {...others}
      class={classed(local, "eden-progress-track")}
    />
  );
};
const ProgressFill = (
  props: Classed<ComponentProps<typeof KProgress.Fill>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KProgress.Fill {...others} class={classed(local, "eden-progress-fill")} />
  );
};
const ProgressLabel = (
  props: Classed<ComponentProps<typeof KProgress.Label>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KProgress.Label
      {...others}
      class={classed(local, "eden-progress-label")}
    />
  );
};
const ProgressValueLabel = (
  props: Classed<ComponentProps<typeof KProgress.ValueLabel>>,
) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <KProgress.ValueLabel
      {...others}
      class={classed(local, "eden-progress-value-label")}
    />
  );
};
export const Progress = Object.assign(ProgressRoot, {
  Root: ProgressRoot,
  Track: ProgressTrack,
  Fill: ProgressFill,
  Label: ProgressLabel,
  ValueLabel: ProgressValueLabel,
});
