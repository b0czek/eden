import * as eden from "@edenapp/client";
import type { DialogController } from "@edenapp/solid-kit/dialogs";
import { button, menu, title } from "@edenapp/tablets";
import type { FilesystemLocation } from "@edenapp/types";
import { createSignal } from "solid-js";
import { editPinnedFolder } from "../dialogs/PinnedFolderDialog";
import { t } from "../i18n";
import {
  defaultPinColor,
  PINNED_FOLDER_LIMIT,
  type PinnedFolder,
  parsePinnedFolders,
  sameLocation,
} from "./pinnedFolders";

const storageKey = "pinned-folders";

export function usePinnedFolders(options: {
  dialogs: DialogController;
  showError: (message: string) => void;
}) {
  const [pins, setPins] = createSignal<PinnedFolder[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const find = (location: FilesystemLocation) =>
    pins().find((pin) => sameLocation(pin.location, location));
  const canPin = (location: FilesystemLocation) =>
    loaded() &&
    !editing() &&
    location.path !== "/" &&
    !find(location) &&
    pins().length < PINNED_FOLDER_LIMIT;

  const load = async () => {
    try {
      const result = await eden.db.get(storageKey);
      setPins(parsePinnedFolders(result.value));
      setLoaded(true);
    } catch {
      options.showError(t("files.errors.loadPinsFailed"));
    }
  };

  const save = async (next: PinnedFolder[]) => {
    const result = await eden.db.set(storageKey, JSON.stringify(next));
    if (!result.success) throw new Error(t("files.errors.savePinsFailed"));
    setPins(next);
  };

  const edit = async (pin: PinnedFolder, adding: boolean) => {
    if (editing()) return;
    setEditing(true);
    try {
      const result = await editPinnedFolder({
        dialogs: options.dialogs,
        pin,
        adding,
      });
      if (!result) return;
      const next = adding
        ? [...pins(), result]
        : pins().map((candidate) =>
            sameLocation(candidate.location, pin.location) ? result : candidate,
          );
      if (next.length > PINNED_FOLDER_LIMIT) return;
      await save(
        next.map((candidate) => ({
          ...candidate,
          label: candidate.label.trim(),
        })),
      );
    } catch {
      options.showError(t("files.errors.savePinsFailed"));
    } finally {
      setEditing(false);
    }
  };

  const pinFolder = async (location: FilesystemLocation, label: string) => {
    if (!canPin(location)) return;
    await edit(
      { location: { ...location }, label, color: defaultPinColor(pins()) },
      true,
    );
  };

  const unpin = async (location: FilesystemLocation) => {
    if (!loaded() || editing()) return;
    setEditing(true);
    try {
      await save(pins().filter((pin) => !sameLocation(pin.location, location)));
    } catch {
      options.showError(t("files.errors.savePinsFailed"));
    } finally {
      setEditing(false);
    }
  };

  const pinMenu = menu((pin: PinnedFolder) => [
    title(pin.label),
    button(
      "edit-pin",
      t("files.editPinnedFolder"),
      async () => {
        const current = find(pin.location);
        if (current) await edit(current, false);
      },
      { icon: "edit", disabled: editing() },
    ),
    button("unpin", t("files.unpinFolder"), () => unpin(pin.location), {
      icon: "minus",
      disabled: editing(),
    }),
  ]);

  return {
    pins,
    load,
    find,
    canPin,
    editing,
    pinFolder,
    unpin,
    showMenu: (pin: PinnedFolder, position: { left: number; top: number }) => {
      void pinMenu.show(pin, position);
    },
  };
}
