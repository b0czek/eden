import type {
  SettingsPanelButtonNode,
  SettingsPanelInputNode,
  SettingsPanelNode,
  SettingsPanelRowNode,
  SettingsPanelStatusNode,
  SettingsPanelToggleNode,
} from "@edenapp/types";
import { type Accessor, Show } from "solid-js";
import type { PanelAction } from "../../types";
import DialogNode from "./DialogNode";
import FieldControl from "./FieldControl";
import { badgeClass, localized, withParams } from "./utils";

export interface ResolvedNodeProps {
  node: SettingsPanelNode | SettingsPanelRowNode;
  path: string;
  inheritedDisabled?: boolean;
  busyActions: Accessor<Set<string>>;
  onAction: PanelAction;
}

const StatusNode = (props: { node: SettingsPanelStatusNode }) => (
  <>
    <div class="setting-info">
      <h4 class="setting-label">{localized(props.node.label)}</h4>
      <Show when={props.node.description}>
        {(value) => <p class="setting-description">{localized(value())}</p>}
      </Show>
      <Show when={props.node.detail}>
        {(value) => (
          <p class="eden-text-sm eden-text-muted">{localized(value())}</p>
        )}
      </Show>
    </div>
    <div class="setting-value">
      <Show when={props.node.value}>
        {(value) => <span>{localized(value())}</span>}
      </Show>
      <Show when={props.node.badge}>
        {(value) => (
          <span class={`eden-badge${badgeClass(value().tone)}`}>
            {localized(value().label)}
          </span>
        )}
      </Show>
    </div>
  </>
);

const ButtonNode = (props: {
  node: SettingsPanelButtonNode;
  path: string;
  disabled: boolean;
  busy: boolean;
  onAction: PanelAction;
}) => (
  <>
    <div class="setting-info">
      <h4 class="setting-label">{localized(props.node.label)}</h4>
      <Show when={props.node.description}>
        {(value) => <p class="setting-description">{localized(value())}</p>}
      </Show>
    </div>
    <button
      type="button"
      class={`eden-btn ${props.node.tone === "danger" ? "eden-btn-danger" : "eden-btn-secondary"}`}
      disabled={props.disabled || props.busy}
      onClick={() => {
        if (
          !props.node.confirmation ||
          window.confirm(localized(props.node.confirmation))
        )
          void props.onAction(
            props.path,
            props.node.action.actionId,
            withParams(props.node.action),
          );
      }}
    >
      {localized(props.node.label)}
    </button>
  </>
);

const ToggleNode = (props: {
  node: SettingsPanelToggleNode;
  path: string;
  disabled: boolean;
  busy: boolean;
  onAction: PanelAction;
}) => (
  <>
    <label class="setting-info" for={`${props.path}-toggle`}>
      <h4 class="setting-label">{localized(props.node.label)}</h4>
      <Show when={props.node.description}>
        {(value) => <p class="setting-description">{localized(value())}</p>}
      </Show>
    </label>
    <input
      id={`${props.path}-toggle`}
      class="eden-toggle"
      type="checkbox"
      checked={props.node.value}
      disabled={props.disabled || props.busy}
      onChange={async (event) => {
        const control = event.currentTarget;
        try {
          await props.onAction(props.path, props.node.action.actionId, {
            ...withParams(props.node.action),
            value: control.checked,
          });
        } finally {
          control.checked = props.node.value;
        }
      }}
    />
  </>
);

const InputNode = (props: {
  node: SettingsPanelInputNode;
  path: string;
  disabled: boolean;
  busy: boolean;
  onAction: PanelAction;
}) => (
  <>
    <div class="setting-info">
      <label
        id={`${props.path}-label`}
        class="setting-label"
        for={`${props.path}-input`}
      >
        {localized(props.node.label)}
      </label>
      <Show when={props.node.description}>
        {(value) => <p class="setting-description">{localized(value())}</p>}
      </Show>
    </div>
    <FieldControl
      field={props.node}
      inputId={`${props.path}-input`}
      value={props.node.value}
      disabled={props.disabled || props.busy}
      deferCommit={
        props.node.input !== "checkbox" &&
        props.node.input !== "select" &&
        props.node.input !== "radio"
      }
      onInput={(value) =>
        props.onAction(props.path, props.node.action.actionId, {
          ...withParams(props.node.action),
          value,
        })
      }
    />
  </>
);

const NodeByKind = (props: ResolvedNodeProps) => {
  const busy = () => props.busyActions().has(props.path);
  const disabled = () =>
    props.inheritedDisabled === true ||
    ("disabled" in props.node && props.node.disabled === true);
  switch (props.node.kind) {
    case "status":
      return <StatusNode node={props.node} />;
    case "button":
      return (
        <ButtonNode
          node={props.node}
          path={props.path}
          busy={busy()}
          disabled={disabled()}
          onAction={props.onAction}
        />
      );
    case "toggle":
      return (
        <ToggleNode
          node={props.node}
          path={props.path}
          busy={busy()}
          disabled={disabled()}
          onAction={props.onAction}
        />
      );
    case "input":
      return (
        <InputNode
          node={props.node}
          path={props.path}
          busy={busy()}
          disabled={disabled()}
          onAction={props.onAction}
        />
      );
    case "dialog":
      return (
        <DialogNode
          node={props.node}
          path={props.path}
          busy={busy()}
          disabled={disabled()}
          onAction={props.onAction}
        />
      );
    case "collection":
      return null;
  }
};

export default function ResolvedNode(props: ResolvedNodeProps) {
  return (
    <Show
      when={
        props.node.kind === "input"
          ? `input:${props.node.input}`
          : props.node.kind
      }
      keyed
    >
      {(_kind) => <NodeByKind {...props} />}
    </Show>
  );
}
