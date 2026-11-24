import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal, onMount } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { NoticeProvider, useNotices } from "./NoticeProvider.js";

const labels = {
  dismiss: "Dismiss",
  showMore: (hidden: number) => `${hidden} more`,
  showLess: "Show less",
};

describe("NoticeProvider", () => {
  afterEach(cleanup);

  it("announces danger as an alert, lets the user dismiss it, and hides extra notices", async () => {
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
      <NoticeProvider labels={labels}>
        <Reporter />
      </NoticeProvider>
    ));

    expect(screen.getByRole("alert").textContent).toContain("write failed");
    expect(screen.getAllByRole("status")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "2 more" }));
    expect(screen.getAllByRole("status")).toHaveLength(4);

    const dismissButtons = screen.getAllByRole("button", { name: "Dismiss" });
    fireEvent.click(dismissButtons[0]);
    expect(screen.queryByRole("alert")).toBeNull();
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
      <NoticeProvider labels={labels}>
        <Condition />
      </NoticeProvider>
    ));

    expect(screen.getByRole("status").textContent).toContain("offline");
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });
});
