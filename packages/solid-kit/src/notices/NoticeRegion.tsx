import type { IconTypes } from "solid-icons";
import {
  FiAlertOctagon,
  FiAlertTriangle,
  FiCheckCircle,
  FiInfo,
  FiX,
} from "solid-icons/fi";
import { createEffect, createSignal, For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { Notice, NoticeSeverity, Notices } from "./createNotices.js";

export interface NoticeLabels {
  /** Accessible name of the dismiss button. */
  dismiss: string;
  /** Text of the button that shows the hidden notices. */
  showMore: (hidden: number) => string;
  /** Text of the button that collapses the list again. */
  showLess: string;
}

export const NOTICE_MAX_VISIBLE = 3;

const severityIcons: Record<NoticeSeverity, IconTypes> = {
  danger: FiAlertOctagon,
  warning: FiAlertTriangle,
  info: FiInfo,
  success: FiCheckCircle,
};

function NoticeItem(props: {
  notice: Notice;
  labels: NoticeLabels;
  onDismiss: (id: string) => void;
}) {
  const urgent = () => props.notice.severity === "danger";
  return (
    <div
      class={`eden-notice eden-notice-${props.notice.severity}`}
      role={urgent() ? "alert" : "status"}
      aria-live={urgent() ? "assertive" : "polite"}
    >
      <span class="eden-notice-icon" aria-hidden="true">
        <Dynamic component={severityIcons[props.notice.severity]} size={18} />
      </span>
      <div class="eden-notice-content">
        <div class="eden-notice-title">
          <span>{props.notice.title}</span>
          <Show when={props.notice.count > 1}>
            <span class="eden-badge eden-notice-count">
              ×{props.notice.count}
            </span>
          </Show>
        </div>
        <Show when={props.notice.detail}>
          <div class="eden-notice-detail">{props.notice.detail}</div>
        </Show>
      </div>
      <Show when={props.notice.kind === "event"}>
        <button
          type="button"
          class="eden-btn eden-btn-ghost eden-btn-sm eden-btn-square eden-notice-dismiss"
          aria-label={props.labels.dismiss}
          title={props.labels.dismiss}
          onClick={() => props.onDismiss(props.notice.id)}
        >
          <FiX size={16} aria-hidden="true" />
        </button>
      </Show>
    </div>
  );
}

export function NoticeRegion(props: {
  notices: Notices;
  labels: NoticeLabels;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const list = () => props.notices.list();
  const visible = () =>
    expanded() ? list() : list().slice(0, NOTICE_MAX_VISIBLE);
  const hidden = () => list().length - visible().length;

  createEffect(() => {
    if (list().length <= NOTICE_MAX_VISIBLE) setExpanded(false);
  });

  return (
    <div class="eden-notice-region">
      <For each={visible()}>
        {(notice) => (
          <NoticeItem
            notice={notice}
            labels={props.labels}
            onDismiss={props.notices.dismiss}
          />
        )}
      </For>
      <Show when={hidden() > 0 || expanded()}>
        <button
          type="button"
          class="eden-btn eden-btn-ghost eden-btn-sm eden-notice-more"
          aria-expanded={expanded()}
          onClick={() => setExpanded(!expanded())}
        >
          {expanded() ? props.labels.showLess : props.labels.showMore(hidden())}
        </button>
      </Show>
    </div>
  );
}
