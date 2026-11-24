import { createRoot, createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNotices, type Notices } from "./createNotices.js";

const titles = (notices: Notices) => notices.list().map((n) => n.title);

describe("createNotices", () => {
  let dispose: (() => void) | undefined;
  const create = () =>
    createRoot((disposeRoot) => {
      dispose = disposeRoot;
      return createNotices({ autoHideMs: 1_000 });
    });

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    dispose?.();
    vi.useRealTimers();
  });

  it("keeps danger and warning notices until dismissed and hides info and success", () => {
    const notices = create();
    const dangerId = notices.report({ severity: "danger", title: "write" });
    notices.report({ severity: "warning", title: "limit" });
    notices.report({ severity: "info", title: "saved draft" });
    notices.report({ severity: "success", title: "saved" });

    vi.advanceTimersByTime(1_000);
    expect(titles(notices)).toEqual(["limit", "write"]);

    notices.dismiss(dangerId);
    expect(titles(notices)).toEqual(["limit"]);
  });

  it("replaces a notice with the same key and counts the repeats", () => {
    const notices = create();
    notices.report({ severity: "danger", title: "first", key: "offset" });
    notices.report({ severity: "danger", title: "other" });
    notices.report({ severity: "danger", title: "second", key: "offset" });

    expect(notices.list()).toMatchObject([
      { title: "second", count: 2 },
      { title: "other", count: 1 },
    ]);
  });

  it("restarts the hide timer when a keyed info notice repeats", () => {
    const notices = create();
    notices.report({ severity: "info", title: "synced", key: "sync" });
    vi.advanceTimersByTime(800);
    notices.report({ severity: "info", title: "synced", key: "sync" });
    vi.advanceTimersByTime(800);
    expect(titles(notices)).toEqual(["synced"]);
    vi.advanceTimersByTime(200);
    expect(titles(notices)).toEqual([]);
  });

  it("shows a condition while it is true, before other notices, and removes it with its owner", () => {
    const notices = create();
    const [offline, setOffline] = createSignal(false);
    const disposeOwner = createRoot((disposeCondition) => {
      notices.condition(offline, { severity: "warning", title: "offline" });
      return disposeCondition;
    });
    notices.report({ severity: "danger", title: "write" });

    expect(titles(notices)).toEqual(["write"]);
    setOffline(true);
    expect(notices.list()).toMatchObject([
      { title: "offline", kind: "condition" },
      { title: "write", kind: "event" },
    ]);
    setOffline(false);
    expect(titles(notices)).toEqual(["write"]);

    setOffline(true);
    disposeOwner();
    expect(titles(notices)).toEqual(["write"]);
  });

  it("follows reactive condition content", () => {
    const notices = create();
    const [title, setTitle] = createSignal("offline");
    createRoot(() =>
      notices.condition(
        () => true,
        () => ({ severity: "warning", title: title() }),
      ),
    );
    setTitle("rozłączono");
    expect(titles(notices)).toEqual(["rozłączono"]);
  });

  it("reports and logs a thrown action failure and resolves to undefined", async () => {
    const notices = create();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("controller rejected the write");

    await expect(
      notices.attempt(() => Promise.reject(failure), { title: "write" }),
    ).resolves.toBeUndefined();
    await expect(
      notices.attempt(() => Promise.resolve(7), { title: "read" }),
    ).resolves.toBe(7);

    expect(notices.list()).toMatchObject([
      {
        severity: "danger",
        title: "write",
        detail: "controller rejected the write",
      },
    ]);
    expect(log).toHaveBeenCalledWith("write", failure);
  });
});
