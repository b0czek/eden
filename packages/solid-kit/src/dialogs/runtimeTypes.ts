import type { Accessor, JSX, Setter } from "solid-js";
import type {
  CustomDialogRenderContext,
  DialogController,
  DialogEnterBehavior,
  DialogSize,
  DialogSubmitResult,
} from "./types.js";

interface DialogRequestMeta {
  id: number;
  title: string;
  message?: JSX.Element | string;
  size: DialogSize;
}

interface DialogRequestBehavior {
  dismissOnBackdrop: boolean;
  dismissOnEscape: boolean;
  onEnter: DialogEnterBehavior;
  selectInitialFocusText: boolean;
}

interface DialogRequestState<TValue> {
  value: Accessor<TValue>;
  setValue: Setter<TValue>;
  canSubmit: Accessor<boolean>;
  setCanSubmit: Setter<boolean>;
}

interface DialogRequestRender<TValue, TResult> {
  render?: (ctx: CustomDialogRenderContext<TValue, TResult>) => JSX.Element;
  footer?: (ctx: CustomDialogRenderContext<TValue, TResult>) => JSX.Element;
  onSubmitAttempt?: (
    result: TResult,
  ) => Promise<DialogSubmitResult<TResult>> | DialogSubmitResult<TResult>;
}

interface DialogRequestResolution<TResult> {
  hasDefaultSubmitResult: boolean;
  defaultSubmitResult?: TResult;
  hasCancelResult: boolean;
  cancelResult?: TResult;
  resolve: (result: TResult) => void;
}

// Internal runtime request shape used by `createDialogs` and `DialogHost`.
export type DialogRequest<
  TValue = unknown,
  TResult = unknown,
> = DialogRequestMeta &
  DialogRequestBehavior &
  DialogRequestState<TValue> &
  DialogRequestRender<TValue, TResult> &
  DialogRequestResolution<TResult>;

export interface DialogRuntimeController extends DialogController {
  active: Accessor<DialogRequest | null>;
  submit: (result?: unknown) => Promise<void>;
}
