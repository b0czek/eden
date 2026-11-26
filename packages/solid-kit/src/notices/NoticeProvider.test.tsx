import { setupI18n } from "@edenapp/babel/solid";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@solidjs/testing-library";
import { createSignal, onMount } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import type { Notices } from "./createNotices.js";
import { NoticeProvider, useNotices } from "./NoticeProvider.js";

const app = setupI18n({ resources: {} });

describe("NoticeProvider", () => {
  afterEach(() => {
    cleanup();
    app.setLocale("en");
  });

  it("announces danger as an alert and others politely, lets the user dismiss them, and hides extra notices", () => {
    function Reporter() {
      const notices = useNotices();
      onMount(() => {
        for (const title of ["a", "b", "c", "d"]) {
          notices.report({ severity: "warning", title });
        }
        notices.report({ severity: "danger", title: "write failed" });
      });
      return null;
    }

    render(() => (
      <NoticeProvider>
        <Reporter />
      </NoticeProvider>
    ));

    expect(screen.getByRole("alert").textContent).toContain("write failed");
    const announced = within(screen.getByRole("status"));
    expect(announced.getByText("d")).toBeTruthy();
    expect(announced.getByText("c")).toBeTruthy();
    expect(announced.queryByText("b")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "2 more" }));
    expect(announced.getByText("b")).toBeTruthy();
    expect(announced.getByText("a")).toBeTruthy();

    const dismissButtons = screen.getAllByRole("button", { name: "Dismiss" });
    fireEvent.click(dismissButtons[0]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps focus on the dismiss button when a keyed notice is replaced", () => {
    let notices!: Notices;
    function Reporter() {
      notices = useNotices();
      return null;
    }

    render(() => (
      <NoticeProvider>
        <Reporter />
      </NoticeProvider>
    ));

    notices.report({ severity: "warning", title: "limit", key: "feed" });
    notices.report({ severity: "warning", title: "speed" });
    const [, dismiss] = screen.getAllByRole("button", { name: "Dismiss" });
    dismiss.focus();
    notices.report({ severity: "warning", title: "limit again", key: "feed" });

    expect(screen.getByText("limit again")).toBeTruthy();
    expect(document.activeElement).toBe(dismiss);
    expect(screen.getAllByRole("button", { name: "Dismiss" })[1]).toBe(dismiss);
  });

  it("gives condition notices no dismiss button", () => {
    function Condition() {
      const [offline] = createSignal(true);
      useNotices().condition(offline, {
        severity: "warning",
        title: "offline",
      });
      return null;
    }

    render(() => (
      <NoticeProvider>
        <Condition />
      </NoticeProvider>
    ));

    expect(screen.getByRole("status").textContent).toContain("offline");
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("labels its controls in the app's language", () => {
    app.setLocale("pl");
    function Reporter() {
      const notices = useNotices();
      onMount(() => {
        for (const title of ["a", "b", "c", "d"]) {
          notices.report({ severity: "warning", title });
        }
      });
      return null;
    }

    render(() => (
      <NoticeProvider>
        <Reporter />
      </NoticeProvider>
    ));

    expect(screen.getByRole("button", { name: "Więcej: 1" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Zamknij" })).toHaveLength(3);
  });
});
