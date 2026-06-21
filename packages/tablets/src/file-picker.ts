import type {
  CommandArgs,
  CommandResult,
  EventData,
  FilePickerOpenArgs,
  FilePickerResult,
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
  openFile: (options?: OpenFilePickerOptions) => Promise<string | null>;
  openFiles: (options?: OpenFilePickerOptions) => Promise<string[] | null>;
  openDirectory: (
    options?: OpenDirectoryPickerOptions,
  ) => Promise<string | null>;
  saveFile: (options?: SaveFilePickerOptions) => Promise<string | null>;
  close: (requestId?: string) => Promise<void>;
}

type FilePickerCommand = "file-picker/open" | "file-picker/close";
type FilePickerEvent = "file-picker/closed";

type EdenAPITransport = {
  shellCommand: <T extends FilePickerCommand>(
    command: T,
    args: CommandArgs<T>,
  ) => Promise<CommandResult<T>>;
  subscribe: <T extends FilePickerEvent>(
    event: T,
    handler: (payload: EventData<T>) => void,
  ) => Promise<void> | void;
};

const getEdenAPI = (): EdenAPITransport => {
  if (typeof window === "undefined") {
    throw new Error("filePicker can only be used in a browser environment.");
  }

  const api = (window as { edenAPI?: EdenAPITransport }).edenAPI;
  if (!api) {
    throw new Error("edenAPI is not available on window.");
  }

  return api;
};

const pendingPickers = new Map<string, (result: FilePickerResult) => void>();
let filePickerSubscribed = false;

const ensureFilePickerSubscribed = async () => {
  if (filePickerSubscribed) return;
  filePickerSubscribed = true;

  const edenAPI = getEdenAPI();
  await edenAPI.subscribe("file-picker/closed", (payload) => {
    const resolver = pendingPickers.get(payload.requestId);
    if (resolver) {
      pendingPickers.delete(payload.requestId);
      resolver(payload);
    }
  });
};

const selectedPathOrNull = (result: FilePickerResult) => {
  if (result.reason !== "select") return null;
  return result.path ?? result.paths?.[0] ?? null;
};

const selectedPathsOrNull = (result: FilePickerResult) => {
  if (result.reason !== "select") return null;
  if (result.paths) return result.paths;
  return result.path ? [result.path] : [];
};

const pick: EdenFilePickerAPI["pick"] = async (options) => {
  await ensureFilePickerSubscribed();

  const edenAPI = getEdenAPI();
  const { requestId } = await edenAPI.shellCommand("file-picker/open", options);

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
  const edenAPI = getEdenAPI();
  await edenAPI.shellCommand("file-picker/close", { requestId });
};

export const filePicker: EdenFilePickerAPI = {
  pick,
  openFile,
  openFiles,
  openDirectory,
  saveFile,
  close,
};
