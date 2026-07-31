import type {
  SettingsPanelDeclaration,
  SettingsPanelState,
} from "@edenapp/types";
import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { LoadedPanel, PanelAction } from "../types";
import GenericPanel from "./GenericPanel";

const panel = (
  declaration: Partial<SettingsPanelDeclaration>,
  state: SettingsPanelState = {},
): LoadedPanel => ({
  declaration: {
    id: "test.panel",
    title: "Test",
    source: "host",
    renderer: "generic",
    sections: [],
    actions: [],
    ...declaration,
  },
  state,
});

describe("GenericPanel", () => {
  it("keeps text inputs editable and commits their draft on blur", async () => {
    const [busy, setBusy] = createSignal(new Set<string>());
    const onAction = vi.fn<PanelAction>(async () => ({ success: true }));
    const loaded = panel(
      {
        sections: [
          {
            id: "main",
            controls: [
              {
                kind: "input",
                input: "text",
                id: "name",
                label: "Name",
                stateKey: "name",
                actionId: "save-name",
              },
            ],
          },
        ],
        actions: [{ id: "save-name", authorized: true }],
      },
      { controls: { name: { value: "E" } } },
    );
    const view = render(() => (
      <GenericPanel panel={loaded} busyActions={busy} onAction={onAction} />
    ));
    const input =
      view.container.querySelector<HTMLInputElement>('input[type="text"]');
    if (!input) throw new Error("Expected text input");

    await fireEvent.input(input, { target: { value: "Eden" } });
    setBusy(new Set(["save-name"]));
    expect(input.disabled).toBe(false);
    expect(input.value).toBe("Eden");
    expect(onAction).not.toHaveBeenCalled();

    await fireEvent.blur(input);
    expect(onAction).toHaveBeenCalledWith("save-name", { value: "Eden" });
  });

  it("disables unauthorized actions and rolls a failed toggle back", async () => {
    const [busy] = createSignal(new Set<string>());
    const onAction = vi.fn<PanelAction>(async () => ({
      success: false,
      error: { code: "action_failed", message: "failed" },
    }));
    const loaded = panel(
      {
        sections: [
          {
            id: "main",
            controls: [
              {
                kind: "toggle",
                id: "enabled",
                label: "Enabled",
                stateKey: "enabled",
                actionId: "toggle",
              },
              {
                kind: "toggle",
                id: "protected",
                label: "Protected",
                stateKey: "protected",
                actionId: "protected-action",
              },
            ],
          },
        ],
        actions: [
          { id: "toggle", authorized: true },
          { id: "protected-action", authorized: false },
        ],
      },
      {
        controls: {
          enabled: { value: false },
          protected: { value: true },
        },
      },
    );
    const view = render(() => (
      <GenericPanel panel={loaded} busyActions={busy} onAction={onAction} />
    ));
    const toggles = view.container.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );

    expect(toggles[0].checked).toBe(false);
    expect(toggles[1].disabled).toBe(true);
    await fireEvent.change(toggles[0], { target: { checked: true } });
    await waitFor(() => expect(onAction).toHaveBeenCalled());
    await waitFor(() => expect(toggles[0].checked).toBe(false));
  });

  it("runs validated forms in dialogs and clears password fields", async () => {
    const [busy] = createSignal(new Set<string>());
    const onAction = vi
      .fn<PanelAction>()
      .mockResolvedValueOnce({
        success: false,
        error: {
          code: "validation",
          message: "Invalid input",
          fields: { "input.password": "Password was rejected." },
        },
      })
      .mockResolvedValueOnce({ success: true });
    const loaded = panel({
      sections: [
        {
          id: "account",
          controls: [
            {
              kind: "dialog",
              id: "ftp-password",
              label: "FTP password",
              description: "Update the FTP connection credential.",
              actionId: "save",
              buttonLabel: "Update password",
              dialog: {
                title: "Update FTP password",
                description: "Enter the credential used by the FTP connection.",
                submitLabel: "Save",
                cancelLabel: "Cancel",
                fields: [
                  {
                    id: "password",
                    label: "FTP password",
                    input: "password",
                    validation: { required: true, minLength: 4 },
                  },
                ],
              },
            },
          ],
        },
      ],
      actions: [{ id: "save", authorized: true }],
    });
    const view = render(() => (
      <GenericPanel panel={loaded} busyActions={busy} onAction={onAction} />
    ));
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();
    await fireEvent.click(view.getByText("Update password"));

    const dialog = view.container.querySelector('[role="dialog"]');
    const form = dialog?.closest("form");
    const password = dialog?.querySelector<HTMLInputElement>(
      'input[type="password"]',
    );
    if (!dialog || !form || !password)
      throw new Error("Expected password dialog");

    await fireEvent.submit(form);
    expect(onAction).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("This field is required.");

    await fireEvent.input(password, { target: { value: "secret" } });
    await fireEvent.submit(form);
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
    expect(onAction.mock.calls[0]?.[1]).toEqual({ password: "secret" });
    expect(view.container.textContent).toContain("Password was rejected.");
    expect(view.container.querySelector('[role="dialog"]')).not.toBeNull();

    await fireEvent.input(password, { target: { value: "accepted" } });
    await fireEvent.submit(form);
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(view.container.querySelector('[role="dialog"]')).toBeNull(),
    );

    await fireEvent.click(view.getByText("Update password"));
    const reopenedPassword = view.container.querySelector<HTMLInputElement>(
      'input[type="password"]',
    );
    if (!reopenedPassword) throw new Error("Expected reopened password dialog");
    expect(reopenedPassword.value).toBe("");
    await fireEvent.input(reopenedPassword, { target: { value: "discarded" } });
    await fireEvent.click(view.getByText("Cancel"));
    await fireEvent.click(view.getByText("Update password"));
    expect(
      view.container.querySelector<HTMLInputElement>('input[type="password"]')
        ?.value,
    ).toBe("");
  });
});
