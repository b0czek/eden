import type { NotificationType } from "@edenapp/types";
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  getOwner,
  onCleanup,
  untrack,
} from "solid-js";

export type NoticeSeverity = NotificationType;

export interface NoticeContent {
  severity: NoticeSeverity;
  title: string;
  detail?: string;
}

export interface NoticeReport extends NoticeContent {
  /** A report with the key of a shown notice replaces it and increments its count. */
  key?: string;
}

export interface Notice extends NoticeContent {
  id: string;
  kind: "event" | "condition";
  key?: string;
  count: number;
}

export interface NoticeAttemptOptions {
  title: string;
  key?: string;
  severity?: "danger" | "warning";
}

export interface Notices {
  /**
   * Shown notices, most severe first. Within a severity, conditions come
   * first, then events, newest first.
   */
  readonly list: Accessor<readonly Notice[]>;
  report(notice: NoticeReport): string;
  dismiss(id: string): void;
  /**
   * Shows a notice while `when` is true. The operator cannot dismiss it. Call
   * inside a reactive owner, such as a component body; the notice is removed
   * when the owner is disposed. Throws when called without an owner, for
   * example after an `await` or in an event handler.
   */
  condition(
    when: Accessor<boolean>,
    content: NoticeContent | Accessor<NoticeContent>,
  ): void;
  /**
   * Runs an action. When it throws, logs the error, reports a notice with the
   * error message as detail, and resolves to `undefined`.
   */
  attempt<T>(
    action: () => Promise<T>,
    options: NoticeAttemptOptions,
  ): Promise<T | undefined>;
}

export interface CreateNoticesOptions {
  /** Time after which info and success notices hide. */
  autoHideMs?: number;
}

export const DEFAULT_NOTICE_AUTO_HIDE_MS = 4_000;

/** The more urgent a severity, the earlier its notices are shown. */
const SEVERITY_RANK: Record<NoticeSeverity, number> = {
  danger: 0,
  warning: 1,
  info: 2,
  success: 3,
};

const hidesBySelf = (severity: NoticeSeverity) =>
  severity === "info" || severity === "success";

const contentOf = (content: NoticeContent): NoticeContent => ({
  severity: content.severity,
  title: content.title,
  detail: content.detail,
});

export function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Creates notice state owned by the current reactive owner. */
export function createNotices(options: CreateNoticesOptions = {}): Notices {
  const autoHideMs = options.autoHideMs ?? DEFAULT_NOTICE_AUTO_HIDE_MS;
  const [events, setEvents] = createSignal<readonly Notice[]>([]);
  const [conditions, setConditions] = createSignal<readonly Notice[]>([]);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let disposed = false;
  let nextId = 0;
  const createId = () => `eden-notice-${nextId++}`;

  const clearTimer = (id: string) => {
    const timer = timers.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    timers.delete(id);
  };

  const dismiss = (id: string) => {
    clearTimer(id);
    setEvents((list) => list.filter((notice) => notice.id !== id));
  };

  const report = (input: NoticeReport) => {
    // A report after the owner is disposed has nowhere to show.
    if (disposed) return createId();
    // Untracked, so that a caller inside a reactive computation does not
    // depend on the notices it reports and re-run on its own report.
    const existing =
      input.key === undefined
        ? undefined
        : untrack(events).find((notice) => notice.key === input.key);
    const notice: Notice = {
      ...contentOf(input),
      id: existing?.id ?? createId(),
      kind: "event",
      key: input.key,
      count: (existing?.count ?? 0) + 1,
    };

    setEvents((list) => [
      notice,
      ...list.filter((shown) => shown.id !== notice.id),
    ]);
    clearTimer(notice.id);
    if (hidesBySelf(notice.severity)) {
      timers.set(
        notice.id,
        setTimeout(() => dismiss(notice.id), autoHideMs),
      );
    }
    return notice.id;
  };

  const removeCondition = (id: string) =>
    setConditions((list) => list.filter((notice) => notice.id !== id));

  const condition: Notices["condition"] = (when, content) => {
    if (!getOwner()) {
      throw new Error(
        "notices.condition must be called inside a reactive owner, such as a component body",
      );
    }
    const id = createId();
    const read = typeof content === "function" ? content : () => content;

    createEffect(() => {
      if (!when()) {
        removeCondition(id);
        return;
      }
      const notice: Notice = {
        ...contentOf(read()),
        id,
        kind: "condition",
        count: 1,
      };
      setConditions((list) =>
        list.some((shown) => shown.id === id)
          ? list.map((shown) => (shown.id === id ? notice : shown))
          : [...list, notice],
      );
    });
    onCleanup(() => removeCondition(id));
  };

  const attempt = async <T>(
    action: () => Promise<T>,
    attemptOptions: NoticeAttemptOptions,
  ): Promise<T | undefined> => {
    try {
      return await action();
    } catch (error) {
      console.error(attemptOptions.title, error);
      report({
        severity: attemptOptions.severity ?? "danger",
        title: attemptOptions.title,
        detail: errorDetail(error),
        key: attemptOptions.key,
      });
      return undefined;
    }
  };

  onCleanup(() => {
    disposed = true;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  });

  // Array.prototype.sort is stable, so each severity keeps conditions first
  // and events newest first.
  const list = createMemo(() =>
    [...conditions(), ...events()].sort(
      (left, right) =>
        SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity],
    ),
  );

  return { list, report, dismiss, condition, attempt };
}
