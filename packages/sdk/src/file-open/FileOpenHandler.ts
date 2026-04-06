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
   * Get the default handler app for a file path
   */
  @EdenHandler("get-handler")
  async handleGetHandler(args: {
    path: string;
  }): Promise<{ appId: string | undefined }> {
    const { path } = args;
    const appId = await this.manager.getHandlerForPath(path);
    return { appId };
  }

  /**
   * Set user preference for a file path's default handler
   */
  @EdenHandler("set-default-handler")
  async handleSetDefaultHandler(args: {
    path: string;
    appId: string;
  }): Promise<void> {
    const { path, appId } = args;
    await this.manager.setDefaultHandler(path, appId);
  }

  /**
   * Remove user preference for a file path (revert to default)
   */
  @EdenHandler("remove-default-handler")
  async handleRemoveDefaultHandler(args: { path: string }): Promise<void> {
    const { path } = args;
    await this.manager.removeDefaultHandler(path);
  }

  /**
   * Get all apps that can handle a specific file path
   */
  @EdenHandler("get-supported-handlers")
  async handleGetSupportedHandlers(args: {
    path: string;
  }): Promise<FileHandlerInfo[]> {
    const { path } = args;
    return this.manager.getSupportedHandlers(path);
  }

  /**
   * Get all file type associations
   */
  @EdenHandler("get-associations")
  async handleGetAssociations(
    _args: Record<string, never>,
  ): Promise<
    Record<
      string,
      { default: string | undefined; userOverride: string | undefined }
    >
  > {
    return this.manager.getAllAssociations();
  }
}
