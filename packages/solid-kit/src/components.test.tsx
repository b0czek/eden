import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { Card as SemanticCard } from "./catalog.js";
import { createDialogs } from "./dialogs/createDialogs.js";
import { DialogHost } from "./dialogs/DialogHost.js";
import {
  AlertDialog,
  Button,
  Checkbox,
  Dialog,
  Popover,
  Progress,
  RadioGroup,
  Select,
  Slider,
  Switch,
  Tabs,
  TextField,
  Tooltip,
} from "./kobalte.js";

afterEach(cleanup);

describe("semantic Eden components", () => {
  it("merges caller classes and typed button variants while forwarding events", async () => {
    let clicked = false;
    render(() => (
      <Button
        class="caller-class"
        variant="primary"
        size="sm"
        onClick={() => {
          clicked = true;
        }}
      >
        Save
      </Button>
    ));

    const button = screen.getByRole("button", { name: "Save" });
    expect(Array.from(button.classList)).toEqual(
      expect.arrayContaining([
        "eden-btn",
        "eden-btn-primary",
        "eden-btn-sm",
        "caller-class",
      ]),
    );
    await fireEvent.click(button);
    expect(clicked).toBe(true);
  });

  it("keeps TextField labels associated with the styled input", () => {
    render(() => (
      <TextField>
        <TextField.Label for="email">Email</TextField.Label>
        <TextField.Input id="email" class="caller-input" />
      </TextField>
    ));

    const input = screen.getByLabelText("Email");
    expect(Array.from(input.classList)).toEqual(
      expect.arrayContaining(["eden-input", "caller-input"]),
    );
    expect(input.getAttribute("id")).toBe("email");
  });

  it("supports uncontrolled checkbox state and Kobalte state attributes", async () => {
    render(() => (
      <Checkbox defaultChecked>
        <Checkbox.Input />
        <Checkbox.Control>
          <Checkbox.Indicator>✓</Checkbox.Indicator>
        </Checkbox.Control>
        <Checkbox.Label>Remember me</Checkbox.Label>
      </Checkbox>
    ));

    const control = screen.getByRole("checkbox");
    expect(control.hasAttribute("data-checked")).toBe(true);
    await fireEvent.click(control);
    expect(control.hasAttribute("data-checked")).toBe(false);
  });

  it("supports selected compound tabs", async () => {
    render(() => (
      <Tabs defaultValue="first">
        <Tabs.List>
          <Tabs.Trigger value="first">First</Tabs.Trigger>
          <Tabs.Trigger value="second">Second</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="first">First panel</Tabs.Content>
        <Tabs.Content value="second">Second panel</Tabs.Content>
      </Tabs>
    ));

    const second = screen.getByRole("tab", { name: "Second" });
    await fireEvent.click(second);
    expect(second.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Second panel")).toBeTruthy();
  });

  it("dismisses Dialog with Escape and resolves DialogHost promises", async () => {
    render(() => (
      <Dialog defaultOpen>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Title>Example</Dialog.Title>
            <Dialog.CloseButton aria-label="Close example">
              Close
            </Dialog.CloseButton>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    ));

    const dialog = screen.getByRole("dialog");
    expect(dialog.classList.contains("eden-modal")).toBe(true);
    await fireEvent.keyDown(dialog, { key: "Escape" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dialog.hasAttribute("data-closed")).toBe(true);

    const dialogs = createDialogs();
    render(() => <DialogHost dialogs={dialogs} closeLabel="Dismiss" />);
    const result = dialogs.confirm({ title: "Delete", message: "Really?" });
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await expect(result).resolves.toBe(true);
  });

  it("adds select compound classes without changing trigger props", () => {
    render(() => (
      <Select
        options={["one", "two"]}
        optionTextValue={(option) => String(option)}
      >
        <Select.Trigger class="trigger-class">
          <Select.Value />
        </Select.Trigger>
        <Select.Portal>
          <Select.Content>
            <Select.Listbox />
          </Select.Content>
        </Select.Portal>
      </Select>
    ));

    expect(Array.from(screen.getByRole("button").classList)).toEqual(
      expect.arrayContaining(["eden-select", "trigger-class"]),
    );
  });

  it("supports keyboard state for switches, radios, sliders, and progress", async () => {
    render(() => (
      <>
        <Switch defaultChecked>
          <Switch.Input aria-label="Notifications" />
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch>
        <RadioGroup defaultValue="email" aria-label="Delivery method">
          <RadioGroup.Item value="email">
            <RadioGroup.ItemInput />
            <RadioGroup.ItemControl>
              <RadioGroup.ItemIndicator />
            </RadioGroup.ItemControl>
            <RadioGroup.ItemLabel>Email</RadioGroup.ItemLabel>
          </RadioGroup.Item>
          <RadioGroup.Item value="sms">
            <RadioGroup.ItemInput />
            <RadioGroup.ItemControl>
              <RadioGroup.ItemIndicator />
            </RadioGroup.ItemControl>
            <RadioGroup.ItemLabel>SMS</RadioGroup.ItemLabel>
          </RadioGroup.Item>
        </RadioGroup>
        <Slider defaultValue={[25]} aria-label="Volume">
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>
        <Progress value={42} aria-label="Loading">
          <Progress.Track>
            <Progress.Fill />
          </Progress.Track>
        </Progress>
      </>
    ));

    const toggle = screen.getByRole("switch");
    expect(toggle.classList.contains("eden-switch-input")).toBe(true);
    expect(toggle.hasAttribute("data-checked")).toBe(true);
    await fireEvent.click(toggle);
    expect(toggle.hasAttribute("data-checked")).toBe(false);

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect((radios[0] as HTMLInputElement).checked).toBe(true);
    expect(
      document
        .querySelectorAll(".eden-radio-option")[0]
        .hasAttribute("data-checked"),
    ).toBe(true);
    await fireEvent.click(radios[1]);
    expect((radios[1] as HTMLInputElement).checked).toBe(true);

    const slider = screen.getByRole("slider");
    await fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider.getAttribute("aria-valuenow")).toBe("26");
    expect(
      screen.getByRole("progressbar").classList.contains("eden-progress"),
    ).toBe(true);
  });

  it("keeps alert dialog, tooltip, and popover relationships accessible", () => {
    render(() => (
      <>
        <AlertDialog open>
          <AlertDialog.Portal>
            <AlertDialog.Overlay />
            <AlertDialog.Content>
              <AlertDialog.Title>Remove user</AlertDialog.Title>
              <AlertDialog.Description>
                This cannot be undone.
              </AlertDialog.Description>
              <AlertDialog.CloseButton>Cancel</AlertDialog.CloseButton>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog>
        <Tooltip open>
          <Tooltip.Trigger as="button">Help</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content>More information</Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip>
        <Popover open>
          <Popover.Trigger>Details</Popover.Trigger>
          <Popover.Portal>
            <Popover.Content>
              <Popover.Title>Details</Popover.Title>
              <Popover.Description>Additional context.</Popover.Description>
            </Popover.Content>
          </Popover.Portal>
        </Popover>
      </>
    ));

    expect(
      screen.getByRole("alertdialog").getAttribute("aria-labelledby"),
    ).toBeTruthy();
    expect(
      screen.getByRole("alertdialog").getAttribute("aria-describedby"),
    ).toBeTruthy();
    const tooltip = screen.getByText("More information");
    expect(tooltip.classList.contains("eden-tooltip")).toBe(true);
    expect(
      screen
        .getByText("Additional context.")
        .parentElement?.classList.contains("eden-popover"),
    ).toBe(true);
  });

  it("supports polymorphic semantic catalog roots and caller refs", () => {
    let link: HTMLAnchorElement | undefined;
    render(() => (
      <SemanticCard as="a" href="/users" ref={link} class="caller-card">
        Users
      </SemanticCard>
    ));

    const card = screen.getByRole("link", { name: "Users" });
    expect(card.tagName).toBe("A");
    expect(card.getAttribute("href")).toBe("/users");
    expect(card.classList.contains("eden-card")).toBe(true);
    expect(card.classList.contains("caller-card")).toBe(true);
    expect(link).toBe(card);
  });
});
