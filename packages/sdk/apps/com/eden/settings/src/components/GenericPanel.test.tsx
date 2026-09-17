import type {
  SettingsPanelGenericSnapshot,
  SettingsPanelView,
} from "@edenapp/types";
import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { PanelAction } from "../types";
import GenericPanel from "./GenericPanel";

const panel = (view: SettingsPanelView): SettingsPanelGenericSnapshot => ({
  id: "test.panel",
  title: "Test",
  source: "host",
  renderer: "generic",
  actions: [],
  view,
});

describe("GenericPanel", () => {
  it.each(["toggle", "checkbox", "select", "radio", "text"] as const)(
    "restores an unchanged %s after action completion",
    async (kind) => {
      const snapshot = () =>
        panel({
          sections: [
            {
              id: "main",
              nodes: [
                kind === "toggle"
                  ? {
                      kind: "toggle",
                      id: "value",
                      label: "Value",
                      value: false,
                      action: { actionId: "save" },
                    }
                  : {
                      kind: "input",
                      id: "value",
                      label: "Value",
                      ...(kind === "checkbox"
                        ? { input: kind, value: false }
                        : kind === "text"
                          ? { input: kind, value: "a" }
                          : {
                              input: kind,
                              value: "a",
                              options: [
                                { value: "a", label: "A" },
                                { value: "b", label: "B" },
                              ],
                            }),
                      action: { actionId: "save" },
                    },
              ],
            },
          ],
        });
      const [loaded, setLoaded] = createSignal(snapshot());
      let finish!: (success: boolean) => void;
      const view = render(() => (
        <GenericPanel
          panel={loaded()}
          busyActions={() => new Set()}
          onAction={async () => {
            const success = await new Promise<boolean>((resolve) => {
              finish = resolve;
            });
            setLoaded(snapshot());
            return { success };
          }}
        />
      ));
      const control = view.container.querySelector<
        HTMLInputElement | HTMLSelectElement
      >(
        kind === "select"
          ? "select"
          : kind === "radio"
            ? 'input[value="b"]'
            : "input",
      )!;
      for (const success of [false, true]) {
        if (kind === "toggle" || kind === "checkbox" || kind === "radio")
          await fireEvent.click(control);
        else if (kind === "select")
          await fireEvent.change(control, { target: { value: "b" } });
        else {
          await fireEvent.input(control, { target: { value: "b" } });
          await fireEvent.blur(control);
        }
        finish(success);
        await waitFor(() => {
          if (kind === "toggle" || kind === "checkbox" || kind === "radio")
            expect((control as HTMLInputElement).checked).toBe(false);
          else expect(control.value).toBe("a");
        });
        if (kind === "radio")
          expect(
            view.container.querySelector<HTMLInputElement>('input[value="a"]')
              ?.checked,
          ).toBe(true);
      }
    },
  );

  it("keeps same-ID radio groups in different sections independent", async () => {
    const view = render(() => (
      <GenericPanel
        panel={panel({
          sections: ["one", "two"].map((id) => ({
            id,
            nodes: [
              {
                kind: "input",
                input: "radio",
                id: "choice",
                label: "Choice",
                value: "a",
                options: [
                  { value: "a", label: "A" },
                  { value: "b", label: "B" },
                ],
                action: { actionId: "save" },
              },
            ],
          })),
        })}
        busyActions={() => new Set()}
        onAction={() => new Promise(() => {})}
      />
    ));
    const radios = view.container.querySelectorAll<HTMLInputElement>(
      'input[type="radio"]',
    );
    await fireEvent.click(radios[1]!);
    expect(radios[0]!.checked).toBe(false);
    expect(radios[1]!.checked).toBe(true);
    expect(radios[2]!.checked).toBe(true);
  });

  it("discards dirty drafts when the input kind changes", async () => {
    const snapshot = (input: "text" | "number", value: string | number) =>
      panel({
        sections: [
          {
            id: "main",
            nodes: [
              {
                kind: "input",
                ...(input === "text"
                  ? { input, value: String(value) }
                  : { input, value: Number(value) }),
                id: "value",
                label: "Value",
                action: { actionId: "save" },
              },
            ],
          },
        ],
      });
    const [loaded, setLoaded] = createSignal(snapshot("text", "initial"));
    const onAction = vi.fn<PanelAction>(async () => ({ success: true }));
    const view = render(() => (
      <GenericPanel
        panel={loaded()}
        busyActions={() => new Set()}
        onAction={onAction}
      />
    ));
    const original = view.container.querySelector("input")!;
    await fireEvent.input(original, { target: { value: "draft" } });
    setLoaded(snapshot("text", "refreshed"));
    expect(original.value).toBe("draft");
    setLoaded(snapshot("number", 42));
    const numeric = view.container.querySelector("input")!;
    expect(numeric.type).toBe("number");
    expect(numeric.value).toBe("42");
    await fireEvent.blur(numeric);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("reconciles sections, nodes, collection items, and row nodes by stable ID", async () => {
    const [loaded, setLoaded] = createSignal(
      panel({
        sections: [
          {
            id: "main",
            nodes: [
              {
                kind: "collection",
                id: "devices",
                label: "Devices",
                items: [
                  {
                    id: "one",
                    title: "One",
                    nodes: [
                      {
                        kind: "status",
                        id: "health",
                        label: "Health",
                        value: "Good",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    const view = render(() => (
      <GenericPanel
        panel={loaded()}
        busyActions={() => new Set()}
        onAction={async () => ({ success: true })}
      />
    ));
    const section = view.container.querySelector(".settings-section");
    const collection = view.container.querySelector(".settings-collection");
    const item = view.container.querySelector(".settings-collection-item");
    const row = view.container.querySelector(".settings-row-node");
    setLoaded(
      panel({
        sections: [
          { id: "other", nodes: [] },
          {
            id: "main",
            nodes: [
              { kind: "status", id: "extra", label: "Extra" },
              {
                kind: "collection",
                id: "devices",
                label: "Devices",
                items: [
                  { id: "two", title: "Two", nodes: [] },
                  {
                    id: "one",
                    title: "Renamed",
                    nodes: [
                      { kind: "status", id: "extra", label: "Extra" },
                      {
                        kind: "status",
                        id: "health",
                        label: "Health",
                        value: "Great",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    await waitFor(() =>
      expect(view.container.textContent).toContain("Renamed"),
    );
    expect(view.container.querySelectorAll(".settings-section")[1]).toBe(
      section,
    );
    expect(view.container.querySelector(".settings-collection")).toBe(
      collection,
    );
    expect(
      view.container.querySelectorAll(".settings-collection-item")[1],
    ).toBe(item);
    expect(item?.querySelectorAll(".settings-row-node")[1]).toBe(row);
  });

  it("uses instance paths for busy state and sends isolated action envelopes", async () => {
    const onAction = vi.fn<PanelAction>(async () => ({ success: true }));
    const firstPath = "section:main/node:devices/item:one/node:toggle";
    const loaded = panel({
      sections: [
        {
          id: "main",
          nodes: [
            {
              kind: "collection",
              id: "devices",
              label: "Devices",
              items: ["one", "two"].map((id) => ({
                id,
                title: id,
                nodes: [
                  {
                    kind: "toggle",
                    id: "toggle",
                    label: "Enabled",
                    value: false,
                    action: { actionId: "set", params: { deviceId: id } },
                  },
                ],
              })),
            },
          ],
        },
      ],
    });
    const view = render(() => (
      <GenericPanel
        panel={loaded}
        busyActions={() => new Set([firstPath])}
        onAction={onAction}
      />
    ));
    const toggles = view.container.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(toggles[0]?.disabled).toBe(true);
    expect(toggles[1]?.disabled).toBe(false);
    if (!toggles[1]) throw new Error("missing toggle");
    await fireEvent.change(toggles[1], { target: { checked: true } });
    expect(onAction).toHaveBeenCalledWith(
      "section:main/node:devices/item:two/node:toggle",
      "set",
      { params: { deviceId: "two" }, value: true },
    );
  });

  it("commits inputs with value envelopes and respects resolved disabled state", async () => {
    const onAction = vi.fn<PanelAction>(async () => ({ success: true }));
    const loaded = panel({
      sections: [
        {
          id: "main",
          nodes: [
            {
              kind: "input",
              input: "text",
              id: "name",
              label: "Name",
              value: "E",
              action: { actionId: "save", params: { scope: "profile" } },
            },
            {
              kind: "button",
              id: "protected",
              label: "Protected",
              disabled: true,
              action: { actionId: "protected" },
            },
          ],
        },
      ],
    });
    const view = render(() => (
      <GenericPanel
        panel={loaded}
        busyActions={() => new Set()}
        onAction={onAction}
      />
    ));
    const input =
      view.container.querySelector<HTMLInputElement>('input[type="text"]');
    if (!input) throw new Error("missing input");
    await fireEvent.input(input, { target: { value: "Eden" } });
    await fireEvent.blur(input);
    expect(onAction).toHaveBeenCalledWith("section:main/node:name", "save", {
      params: { scope: "profile" },
      value: "Eden",
    });
    expect(
      (
        view
          .getAllByText("Protected")
          .find(
            (element) => element instanceof HTMLButtonElement,
          ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("preserves compatible dialog drafts across views and always clears passwords", async () => {
    const onAction = vi.fn<PanelAction>(async () => ({
      success: false,
      error: {
        code: "validation",
        message: "Invalid",
        fields: { "fields.password": "Rejected" },
      },
    }));
    const dialog = (label: string, includeNote = true): SettingsPanelView => ({
      sections: [
        {
          id: "main",
          nodes: [
            {
              kind: "dialog",
              id: "credentials",
              label: "Credentials",
              buttonLabel: "Edit",
              action: { actionId: "save", params: { accountId: "one" } },
              dialog: {
                title: label,
                fields: [
                  ...(includeNote
                    ? [
                        {
                          id: "note",
                          label: "Note",
                          input: "text" as const,
                          value: "initial",
                        },
                      ]
                    : []),
                  {
                    id: "password",
                    label: "Password",
                    input: "password" as const,
                    validation: { required: true },
                  },
                ],
                submitLabel: "Save",
                cancelLabel: "Cancel",
              },
            },
          ],
        },
      ],
    });
    const [loaded, setLoaded] = createSignal(panel(dialog("Credentials")));
    const view = render(() => (
      <GenericPanel
        panel={loaded()}
        busyActions={() => new Set()}
        onAction={onAction}
      />
    ));
    await fireEvent.click(view.getByText("Edit"));
    const activeDialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const note =
      activeDialog?.querySelector<HTMLInputElement>('input[type="text"]');
    const password = activeDialog?.querySelector<HTMLInputElement>(
      'input[type="password"]',
    );
    if (!activeDialog || !note || !password) throw new Error("missing fields");
    await fireEvent.input(note, { target: { value: "draft" } });
    await fireEvent.input(password, { target: { value: "secret" } });
    setLoaded(panel(dialog("Updated")));
    await waitFor(() => expect(document.body.textContent).toContain("Updated"));
    expect(
      activeDialog.querySelector<HTMLInputElement>('input[type="text"]')?.value,
    ).toBe("draft");
    const form = document.querySelector<HTMLFormElement>('form[role="dialog"]');
    if (!form) throw new Error("missing form");
    await fireEvent.submit(form);
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith(
        "section:main/node:credentials",
        "save",
        {
          params: { accountId: "one" },
          fields: { note: "draft", password: "secret" },
        },
      ),
    );
    expect(
      activeDialog.querySelector<HTMLInputElement>('input[type="password"]')
        ?.value,
    ).toBe("");
    setLoaded(panel(dialog("Updated again", false)));
    await waitFor(() =>
      expect(
        activeDialog.querySelector<HTMLInputElement>('input[type="text"]'),
      ).toBeNull(),
    );
    view.unmount();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
