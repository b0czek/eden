import type { EdenAPI } from "@edenapp/types/ipc";
import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { For } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import UsersTab from "./UsersTab";

vi.mock("../../i18n", () => ({ t: (key: string) => key }));
vi.mock("../../dialogs/CreateUserDialog", () => ({ default: () => null }));
vi.mock("../../dialogs/SetPasswordDialog", () => ({ default: () => null }));
vi.mock("./UsersList", () => ({
  default: (props: { onSelect: (username: string) => void }) => (
    <button type="button" onClick={() => props.onSelect("vendor")}>
      Select vendor
    </button>
  ),
}));
vi.mock("./UserDetail", () => ({
  default: (props: {
    grantOptions: Array<{ grant: string; label: string }>;
  }) => (
    <div>
      <For each={props.grantOptions}>
        {(option) => <span>{option.label}</span>}
      </For>
    </div>
  ),
}));

describe("Users live grant catalog", () => {
  it("refreshes open user details when grant options change", async () => {
    let revision = 1;
    let options = [
      { grant: "panels/one", kind: "panel" as const, label: "Panel one" },
    ];
    let changed: (() => void) | undefined;
    window.edenAPI = {
      shellCommand: vi.fn(async (command: string) => {
        if (command === "user/list") {
          return {
            users: [
              {
                username: "vendor",
                name: "Vendor",
                role: "vendor",
                grants: [],
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          };
        }
        if (command === "session/get-current") return { user: null };
        if (command === "user/get-default") return { username: null };
        if (command === "user/grant-options") return { revision, options };
        throw new Error(`Unexpected command ${command}`);
      }),
      subscribe: vi.fn(async (_event, callback) => {
        changed = callback as () => void;
      }),
      unsubscribe: vi.fn(),
      isEventSupported: vi.fn(async () => true),
      getLaunchArgs: () => [],
    } as unknown as EdenAPI;

    const view = render(() => <UsersTab />);
    await fireEvent.click(await view.findByText("Select vendor"));
    await waitFor(() => expect(view.getByText("Panel one")).toBeTruthy());

    revision = 2;
    options = [
      ...options,
      { grant: "panels/two", kind: "panel", label: "Panel two" },
    ];
    await changed?.();

    await waitFor(() => expect(view.getByText("Panel two")).toBeTruthy());
  });
});
