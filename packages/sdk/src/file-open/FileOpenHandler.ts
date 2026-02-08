import type { FileHandlerInfo, FileOpenResult } from "@edenapp/types";
import { EdenHandler, EdenNamespace } from "../ipc";
import type { FileOpenManager } from "./FileOpenManager";

/**
 * FileOpenHandler
 *
 * Command endpoints for file opening functionality.
 */
@EdenNamespace("file")
export class FileOpenHandler {
  private manager: FileOpenManager;

  constructor(manager: FileOpenManager) {
    this.manager = manager;
  }

  /**
   * Open a file with its default handler
   */
  @EdenHandler("open")
  async handleOpen(args: { path: string }): Promise<FileOpenResult> {
    const { path } = args;
    return this.manager.openFile(path);
  }

  /**
   * Open a file with a specific app
   */
  @EdenHandler("open-with")
  async handleOpenWith(args: {
    path: string;
    appId: string;
  }): Promise<FileOpenResult> {
    const { path, appId } = args;
    return this.manager.openFileWith(path, appId);
  }

  /**
   * Get the default handler app for a file extension
   */
  @EdenHandler("get-handler")
  async handleGetHandler(args: {
    extension: string;
  }): Promise<{ appId: string | undefined }> {
    const { extension } = args;
    const appId = this.manager.getHandlerForExtension(extension);
    return { appId };
  }

  /**
   * Set user preference for a file extension's default handler
   */
  @EdenHandler("set-default-handler")
  async handleSetDefaultHandler(args: {
    extension: string;
    appId: string;
  }): Promise<void> {
    const { extension, appId } = args;
    await this.manager.setDefaultHandler(extension, appId);
  }

  /**
   * Remove user preference for a file extension (revert to default)
   */
  @EdenHandler("remove-default-handler")
  async handleRemoveDefaultHandler(args: { extension: string }): Promise<void> {
    const { extension } = args;
    await this.manager.removeDefaultHandler(extension);
  }

  /**
   * Get all apps that can handle a specific file extension
   */
  @EdenHandler("get-supported-handlers")
  async handleGetSupportedHandlers(args: {
    extension: string;
  }): Promise<FileHandlerInfo[]> {
    const { extension } = args;
    return this.manager.getSupportedHandlers(extension);
  }

  /**
   * Get all file type associations
   */
  @EdenHandler("get-associations")
  async handleGetAssociations(
    args: Record<string, never>,
  ): Promise<
    Record<
      string,
      { default: string | undefined; userOverride: string | undefined }
    >
  > {
    return this.manager.getAllAssociations();
  }
}
