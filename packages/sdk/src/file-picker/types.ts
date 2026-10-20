export interface FilePickerCaller {
  appId?: string;
  webContentsId?: number;
}

export interface FilePickerRequest {
  requestId: string;
  allowedVolumes?: string[];
  mode: "open" | "save";
  opener: { appId: string; viewId: number };
}
