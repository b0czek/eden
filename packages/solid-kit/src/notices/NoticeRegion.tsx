import type { IconTypes } from "solid-icons";
import {
  FiAlertOctagon,
  FiAlertTriangle,
  FiCheckCircle,
  FiInfo,
  FiX,
} from "solid-icons/fi";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { fillString, solidKitStrings } from "../locale.js";
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
  dismiss: string;
  onDismiss: (id: string) => void;
}) {
  // Most screen readers announce an alert inserted into the page. Other
  // notices are announced by the polite live region that contains them.
  return (
    <div
      class={`eden-notice eden-notice-${props.notice.severity}`}
      role={props.notice.severity === "danger" ? "alert" : undefined}
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
          aria-label={props.dismiss}
          title={props.dismiss}
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
  /** Replaces the built-in text of the notice controls. */
  labels?: Partial<NoticeLabels>;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const text = () => solidKitStrings("notices");
  const dismiss = () => props.labels?.dismiss ?? text().dismiss;
  const showMore = (hidden: number) =>
    props.labels?.showMore?.(hidden) ??
    fillString(text().showMore, { count: hidden });
  const list = () => props.notices.list();
  const visible = () =>
    expanded() ? list() : list().slice(0, NOTICE_MAX_VISIBLE);
  const hidden = () => list().length - visible().length;
  const byId = createMemo(
    () => new Map(list().map((notice) => [notice.id, notice])),
  );
  // Keyed by id, so a keyed replacement updates the shown element in place and
  // keeps focus on its dismiss button.
  const visibleIds = () => visible().map((notice) => notice.id);

  createEffect(() => {
    if (list().length <= NOTICE_MAX_VISIBLE) setExpanded(false);
  });

  return (
    <div class="eden-notice-region">
      {/* The live region stays in the page, so screen readers announce the
          notices added to it. aria-atomic="false" announces only the change. */}
      <div class="eden-notice-list" role="status" aria-atomic="false">
        <For each={visibleIds()}>
          {(id) => (
            <Show when={byId().get(id)}>
              {(notice) => (
                <NoticeItem
                  notice={notice()}
                  dismiss={dismiss()}
                  onDismiss={props.notices.dismiss}
                />
              )}
            </Show>
          )}
        </For>
      </div>
      <Show when={hidden() > 0 || expanded()}>
        <button
          type="button"
          class="eden-btn eden-btn-ghost eden-btn-sm eden-notice-more"
          aria-expanded={expanded()}
          onClick={() => setExpanded(!expanded())}
        >
          {expanded()
            ? (props.labels?.showLess ?? text().showLess)
            : showMore(hidden())}
        </button>
      </Show>
    </div>
  );
}
