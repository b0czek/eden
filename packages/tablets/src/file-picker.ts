import * as eden from "@edenapp/client";
import type {
  FilePickerOpenArgs,
  FilePickerResult,
  FilesystemLocation,
} from "@edenapp/types";

export type FilePickerOptions = Omit<FilePickerOpenArgs, "mode">;
export type OpenFilePickerOptions = Omit<
  FilePickerOpenArgs,
  "mode" | "multiple" | "selection"
>;
export type OpenDirectoryPickerOptions = Omit<
  FilePickerOpenArgs,
  "mode" | "selection"
>;
export type SaveFilePickerOptions = Omit<
  FilePickerOpenArgs,
  "mode" | "multiple" | "selection"
>;

export interface EdenFilePickerAPI {
  pick: (options: FilePickerOpenArgs) => Promise<FilePickerResult>;
  openFile: (
    options?: OpenFilePickerOptions,
  ) => Promise<FilesystemLocation | null>;
  openFiles: (
    options?: OpenFilePickerOptions,
  ) => Promise<FilesystemLocation[] | null>;
  openDirectory: (
    options?: OpenDirectoryPickerOptions,
  ) => Promise<FilesystemLocation | null>;
  saveFile: (
    options?: SaveFilePickerOptions,
  ) => Promise<FilesystemLocation | null>;
  close: (requestId?: string) => Promise<void>;
}

const pendingPickers = new Map<string, (result: FilePickerResult) => void>();
let filePickerSubscription: Promise<void> | undefined;

const ensureFilePickerSubscribed = () => {
  filePickerSubscription ??= Promise.resolve()
    .then(() =>
      eden.filePicker.subscribe("closed", (payload) => {
        const resolver = pendingPickers.get(payload.requestId);
        if (resolver) {
          pendingPickers.delete(payload.requestId);
          resolver(payload);
        }
      }),
    )
    .catch((error) => {
      filePickerSubscription = undefined;
      throw error;
    });
  return filePickerSubscription;
};

const selectedPathOrNull = (result: FilePickerResult) => {
  if (result.reason !== "select") return null;
  return result.locations?.[0] ?? null;
};

const selectedPathsOrNull = (result: FilePickerResult) => {
  if (result.reason !== "select") return null;
  return result.locations ?? [];
};

const pick: EdenFilePickerAPI["pick"] = async (options) => {
  await ensureFilePickerSubscribed();

  const { requestId } = await eden.filePicker.open(options.mode, options);

  return new Promise((resolve) => {
    pendingPickers.set(requestId, resolve);
  });
};

const openFile: EdenFilePickerAPI["openFile"] = async (options = {}) => {
  const result = await pick({
    ...options,
    mode: "open",
    selection: "file",
    multiple: false,
  });
  return selectedPathOrNull(result);
};

const openFiles: EdenFilePickerAPI["openFiles"] = async (options = {}) => {
  const result = await pick({
    ...options,
    mode: "open",
    selection: "file",
    multiple: true,
  });
  return selectedPathsOrNull(result);
};

const openDirectory: EdenFilePickerAPI["openDirectory"] = async (
  options = {},
) => {
  const result = await pick({
    ...options,
    mode: "open",
    selection: "directory",
  });
  return selectedPathOrNull(result);
};

const saveFile: EdenFilePickerAPI["saveFile"] = async (options = {}) => {
  const result = await pick({
    ...options,
    mode: "save",
    selection: "file",
    multiple: false,
    overwritePrompt: options.overwritePrompt ?? true,
  });
  return selectedPathOrNull(result);
};

const close: EdenFilePickerAPI["close"] = async (requestId) => {
  await eden.filePicker.close({ requestId });
};

export const filePicker: EdenFilePickerAPI = {
  pick,
  openFile,
  openFiles,
  openDirectory,
  saveFile,
  close,
};
