import { createSignal } from "solid-js";
import type {
  AlertDialogOptions,
  ConfirmDialogOptions,
  CustomDialogOptions,
  CustomDialogRenderContext,
  DialogController,
  DialogFormField,
  DialogFormValues,
  DialogRequest,
  DialogTone,
  FormDialogOptions,
  PromptDialogOptions,
} from "./types.js";

type FormValueRecord = Record<string, string | boolean>;

const hasOwn = <K extends string>(value: unknown, key: K): boolean => {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, key)
  );
};

const confirmButtonClass = (tone: DialogTone) => {
  return tone === "danger"
    ? "eden-btn eden-btn-danger"
    : "eden-btn eden-btn-primary";
};

const getDefaultFormFieldValue = (field: DialogFormField): string | boolean => {
  if (field.kind === "checkbox") {
    return field.initialValue ?? false;
  }

  return field.initialValue ?? "";
};

const createInitialFormValues = (fields: readonly DialogFormField[]) => {
  const values: FormValueRecord = {};

  for (const field of fields) {
    values[field.key] = getDefaultFormFieldValue(field);
  }

  return values;
};

const isRequiredFieldFilled = (
  field: DialogFormField,
  value: string | boolean | undefined,
): boolean => {
  if (!field.required) return true;

  if (field.kind === "checkbox") {
    return value === true;
  }

  return typeof value === "string" && value.trim().length > 0;
};

const isFormSubmittable = (
  fields: readonly DialogFormField[],
  values: FormValueRecord,
): boolean => {
  return fields.every((field) =>
    isRequiredFieldFilled(field, values[field.key]),
  );
};

const getInitialFocusFieldKey = (
  fields: readonly DialogFormField[],
): string | null => {
  const explicit = fields.find((field) => field.autofocus);
  if (explicit) {
    return explicit.key;
  }

  const firstInteractive = fields.find((field) => field.kind !== "checkbox");
  return firstInteractive?.key ?? null;
};

export const createDialogs = (): DialogController => {
  const [active, setActive] = createSignal<DialogRequest | null>(null);
  const queue: DialogRequest[] = [];
  let requestId = 0;

  const pump = () => {
    if (active()) return;

    const next = queue.shift();
    if (!next) return;

    setActive(next);
  };

  const enqueue = (request: DialogRequest) => {
    queue.push(request);
    pump();
  };

  const closeAndContinue = () => {
    setActive(null);
    queueMicrotask(pump);
  };

  const custom: DialogController["custom"] = (options) => {
    return new Promise((resolve) => {
      const [value, setValue] = createSignal(options.initialValue as unknown);
      const [canSubmit, setCanSubmit] = createSignal(
        options.initialCanSubmit ?? true,
      );

      const hasDefaultSubmitResult = hasOwn(options, "defaultSubmitResult");
      const hasCancelResult = hasOwn(options, "cancelResult");

      enqueue({
        id: ++requestId,
        title: options.title,
        message: options.message,
        size: options.size ?? "sm",
        dismissOnBackdrop: options.dismissOnBackdrop ?? true,
        dismissOnEscape: options.dismissOnEscape ?? true,
        onEnter: options.onEnter ?? "submit",
        selectInitialFocusText: options.selectInitialFocusText ?? false,
        value,
        setValue,
        canSubmit,
        setCanSubmit,
        render: options.render as DialogRequest["render"],
        footer: options.footer as DialogRequest["footer"],
        hasDefaultSubmitResult,
        defaultSubmitResult: hasDefaultSubmitResult
          ? (options as { defaultSubmitResult: unknown }).defaultSubmitResult
          : undefined,
        hasCancelResult,
        cancelResult: hasCancelResult
          ? (options as { cancelResult: unknown }).cancelResult
          : undefined,
        resolve: resolve as (result: unknown) => void,
      });
    });
  };

  const submit: DialogController["submit"] = function (result?: unknown) {
    const current = active();
    if (!current || !current.canSubmit()) return;

    const hasExplicitResult = arguments.length > 0;
    const resolvedResult = hasExplicitResult
      ? result
      : current.hasDefaultSubmitResult
        ? current.defaultSubmitResult
        : current.value();

    current.resolve(resolvedResult);
    closeAndContinue();
  };

  const cancel: DialogController["cancel"] = () => {
    const current = active();
    if (!current) return;

    const resolvedResult = current.hasCancelResult
      ? current.cancelResult
      : null;
    current.resolve(resolvedResult);
    closeAndContinue();
  };

  const alert = async (options: AlertDialogOptions): Promise<void> => {
    await custom<void, void>({
      title: options.title,
      message: options.message,
      size: options.size,
      dismissOnBackdrop: options.dismissOnBackdrop,
      dismissOnEscape: options.dismissOnEscape,
      onEnter: options.onEnter,
      initialValue: undefined,
      cancelResult: undefined,
      footer: (ctx) => (
        <button
          ref={ctx.setPrimaryActionRef}
          class="eden-btn eden-btn-primary"
          onClick={() => ctx.submit()}
        >
          {options.okLabel ?? "OK"}
        </button>
      ),
    });
  };

  const confirm = (options: ConfirmDialogOptions): Promise<boolean> => {
    const tone = options.tone ?? "default";

    return custom<void, boolean>({
      title: options.title,
      message: options.message,
      size: options.size,
      dismissOnBackdrop: options.dismissOnBackdrop,
      dismissOnEscape: options.dismissOnEscape,
      onEnter: options.onEnter,
      initialValue: undefined,
      defaultSubmitResult: true,
      cancelResult: false,
      footer: (ctx) => (
        <>
          <button class="eden-btn" onClick={() => ctx.cancel()}>
            {options.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={ctx.setPrimaryActionRef}
            class={confirmButtonClass(tone)}
            onClick={() => ctx.submit(true)}
          >
            {options.confirmLabel ?? "OK"}
          </button>
        </>
      ),
    });
  };

  const prompt = (options: PromptDialogOptions): Promise<string | null> => {
    const tone = options.tone ?? "default";

    return custom<string, string | null>({
      title: options.title,
      message: options.message,
      size: options.size,
      dismissOnBackdrop: options.dismissOnBackdrop,
      dismissOnEscape: options.dismissOnEscape,
      onEnter: options.onEnter,
      selectInitialFocusText: true,
      initialValue: options.initialValue ?? "",
      cancelResult: null,
      render: (ctx) => (
        <div class="eden-form-group">
          {options.label && (
            <label class="eden-form-label">{options.label}</label>
          )}
          <input
            ref={ctx.setInitialFocusRef}
            type="text"
            class="eden-input"
            placeholder={options.placeholder}
            value={ctx.value()}
            onInput={(e) => ctx.setValue(e.currentTarget.value)}
          />
          {options.hint && <p class="eden-form-help">{options.hint}</p>}
        </div>
      ),
      footer: (ctx) => (
        <>
          <button class="eden-btn" onClick={() => ctx.cancel()}>
            {options.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={ctx.setPrimaryActionRef}
            class={confirmButtonClass(tone)}
            onClick={() => ctx.submit()}
          >
            {options.confirmLabel ?? "OK"}
          </button>
        </>
      ),
    });
  };

  const form = <TFields extends readonly DialogFormField[]>(
    options: FormDialogOptions<TFields>,
  ): Promise<DialogFormValues<TFields> | null> => {
    const tone = options.tone ?? "default";
    const focusFieldKey = getInitialFocusFieldKey(options.fields);
    const initialValues = createInitialFormValues(
      options.fields,
    ) as DialogFormValues<TFields>;

    return custom<DialogFormValues<TFields>, DialogFormValues<TFields> | null>({
      title: options.title,
      message: options.message,
      size: options.size,
      dismissOnBackdrop: options.dismissOnBackdrop,
      dismissOnEscape: options.dismissOnEscape,
      onEnter: options.onEnter,
      initialValue: initialValues,
      initialCanSubmit: isFormSubmittable(
        options.fields,
        initialValues as FormValueRecord,
      ),
      cancelResult: null,
      render: (ctx) => (
        <div class="eden-flex-col eden-gap-md">
          {options.fields.map((field) => {
            const values = ctx.value() as FormValueRecord;
            const fieldValue = values[field.key];
            const setFieldValue = (nextValue: string | boolean) => {
              const nextValues = {
                ...values,
                [field.key]: nextValue,
              } as FormValueRecord;

              ctx.setValue(() => nextValues as DialogFormValues<TFields>);
              ctx.setCanSubmit(isFormSubmittable(options.fields, nextValues));
            };

            const isFocusField =
              focusFieldKey != null && focusFieldKey === field.key;

            if (field.kind === "checkbox") {
              return (
                <div class="eden-form-group">
                  <label class="eden-checkbox-option">
                    <input
                      ref={isFocusField ? ctx.setInitialFocusRef : undefined}
                      type="checkbox"
                      class="eden-checkbox"
                      checked={fieldValue === true}
                      disabled={field.disabled}
                      onChange={(e) => setFieldValue(e.currentTarget.checked)}
                    />
                    <span class="eden-checkbox-option-label">
                      {field.label}
                    </span>
                  </label>
                  {field.hint && <p class="eden-form-help">{field.hint}</p>}
                </div>
              );
            }

            if (field.kind === "textarea") {
              return (
                <div class="eden-form-group">
                  <label class="eden-form-label">{field.label}</label>
                  <textarea
                    ref={isFocusField ? ctx.setInitialFocusRef : undefined}
                    class="eden-textarea"
                    placeholder={field.placeholder}
                    value={String(fieldValue ?? "")}
                    disabled={field.disabled}
                    rows={3}
                    onInput={(e) => setFieldValue(e.currentTarget.value)}
                  />
                  {field.hint && <p class="eden-form-help">{field.hint}</p>}
                </div>
              );
            }

            return (
              <div class="eden-form-group">
                <label class="eden-form-label">{field.label}</label>
                <input
                  ref={isFocusField ? ctx.setInitialFocusRef : undefined}
                  type={field.kind}
                  class="eden-input"
                  placeholder={field.placeholder}
                  value={String(fieldValue ?? "")}
                  disabled={field.disabled}
                  onInput={(e) => setFieldValue(e.currentTarget.value)}
                />
                {field.hint && <p class="eden-form-help">{field.hint}</p>}
              </div>
            );
          })}
        </div>
      ),
      footer: (ctx) => (
        <>
          <button class="eden-btn" onClick={() => ctx.cancel()}>
            {options.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={ctx.setPrimaryActionRef}
            class={confirmButtonClass(tone)}
            disabled={!ctx.canSubmit()}
            onClick={() => ctx.submit()}
          >
            {options.confirmLabel ?? "OK"}
          </button>
        </>
      ),
    });
  };

  return {
    active,
    submit,
    cancel,
    custom,
    alert,
    confirm,
    prompt,
    form,
  };
};

export type {
  CustomDialogOptions,
  CustomDialogRenderContext,
  DialogFormField,
  DialogFormValues,
  FormDialogOptions,
} from "./types.js";
