import type {
  FileHandlerInfo,
  FileOpenResult,
  FilesystemLocation,
} from "@edenapp/types";
import * as v from "valibot";
import {
  filesystemLocationArgsSchema,
  filesystemLocationSchema,
} from "../filesystem/FilesystemLocationSchema";
import { EdenHandler, EdenNamespace } from "../ipc";
import type { FileOpenManager } from "./FileOpenManager";

const handlerArgs = v.object({
  location: filesystemLocationSchema,
  appId: v.pipe(v.string(), v.nonEmpty()),
});

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
  async handleOpen(args: {
    location: FilesystemLocation;
  }): Promise<FileOpenResult> {
    const { location } = v.parse(filesystemLocationArgsSchema, args);
    return this.manager.openFile(location);
  }

  /**
   * Open a file with a specific app
   */
  @EdenHandler("open-with")
  async handleOpenWith(args: {
    location: FilesystemLocation;
    appId: string;
  }): Promise<FileOpenResult> {
    const { location, appId } = v.parse(handlerArgs, args);
    return this.manager.openFileWith(location, appId);
  }

  /**
   * Get the default handler app for a file path
   */
  @EdenHandler("get-handler")
  async handleGetHandler(args: {
    location: FilesystemLocation;
  }): Promise<{ appId: string | undefined }> {
    const { location } = v.parse(filesystemLocationArgsSchema, args);
    const appId = await this.manager.getHandlerForPath(location);
    return { appId };
  }

  /**
   * Set user preference for a file path's default handler
   */
  @EdenHandler("set-default-handler")
  async handleSetDefaultHandler(args: {
    location: FilesystemLocation;
    appId: string;
  }): Promise<void> {
    const { location, appId } = v.parse(handlerArgs, args);
    await this.manager.setDefaultHandler(location, appId);
  }

  /**
   * Remove user preference for a file path (revert to default)
   */
  @EdenHandler("remove-default-handler")
  async handleRemoveDefaultHandler(args: {
    location: FilesystemLocation;
  }): Promise<void> {
    const { location } = v.parse(filesystemLocationArgsSchema, args);
    await this.manager.removeDefaultHandler(location);
  }

  /**
   * Get all apps that can handle a specific file path
   */
  @EdenHandler("get-supported-handlers")
  async handleGetSupportedHandlers(args: {
    location: FilesystemLocation;
  }): Promise<FileHandlerInfo[]> {
    const { location } = v.parse(filesystemLocationArgsSchema, args);
    return this.manager.getSupportedHandlers(location);
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
