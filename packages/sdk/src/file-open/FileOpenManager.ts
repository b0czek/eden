import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  FileHandlerConfig,
  FileHandlerInfo,
  FileOpenResult,
  RuntimeAppManifest,
} from "@edenapp/types";
import { inject, injectable, singleton } from "tsyringe";
import { WASMagic } from "wasmagic";
import { FilesystemManager } from "../filesystem";
import { CommandRegistry, EdenEmitter, EdenNamespace, IPCBridge } from "../ipc";
import { log } from "../logging";
import { PackageManager } from "../package-manager";
import { ProcessManager } from "../process-manager";
import { ViewManager } from "../view-manager";
import { FileOpenHandler } from "./FileOpenHandler";

/**
 * Events emitted by the FileOpenManager
 */
interface FileNamespaceEvents {
  opened: { path: string; isDirectory: boolean; appId: string };
}

/**
 * FileOpenManager
 *
 * Manages file type associations and handles opening files with appropriate applications.
 */
@singleton()
@injectable()
@EdenNamespace("file")
export class FileOpenManager extends EdenEmitter<FileNamespaceEvents> {
  private preferencesPath: string;
  private fileOpenHandler: FileOpenHandler;
  private mimeDetectorPromise?: Promise<WASMagic>;

  // User override preferences (file type key -> app ID)
  private userPreferences: Map<string, string> = new Map();
  private static readonly DIRECTORY_PREFERENCE_KEY = "directory";
  private static readonly MIME_DETECTION_BYTES = 8192;

  constructor(
    @inject("userDirectory") userDirectory: string,
    @inject(PackageManager) private packageManager: PackageManager,
    @inject(ProcessManager) private processManager: ProcessManager,
    @inject(ViewManager) private viewManager: ViewManager,
    @inject(FilesystemManager) private fsManager: FilesystemManager,
    @inject(IPCBridge) ipcBridge: IPCBridge,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
  ) {
    super(ipcBridge);
    this.preferencesPath = path.join(userDirectory, "file-associations.json");

    // Create and register handler
    this.fileOpenHandler = new FileOpenHandler(this);
    commandRegistry.registerManager(this.fileOpenHandler);
  }

  /**
   * Initialize with user preferences loaded from disk
   */
  async initialize(): Promise<void> {
    await this.loadUserPreferences();
    log.info(
      `FileOpenManager initialized with ${this.userPreferences.size} user preferences`,
    );
  }

  /**
   * Load user preferences from disk
   */
  private async loadUserPreferences(): Promise<void> {
    try {
      const content = await fs.readFile(this.preferencesPath, "utf-8");
      const prefs = JSON.parse(content) as Record<string, string>;
      this.userPreferences = new Map(Object.entries(prefs));
    } catch {
      // File doesn't exist or is invalid, start with empty preferences
      this.userPreferences = new Map();
    }
  }

  /**
   * Save user preferences to disk
   */
  private async saveUserPreferences(): Promise<void> {
    const prefs = Object.fromEntries(this.userPreferences);
    await fs.mkdir(path.dirname(this.preferencesPath), { recursive: true });
    await fs.writeFile(this.preferencesPath, JSON.stringify(prefs, null, 2));
  }

  /**
   * Normalize a file extension (lowercase, without leading dot)
   */
  private normalizeExtension(extension: string): string {
    return extension.toLowerCase().replace(/^\./, "");
  }

  /**
   * Normalize a MIME type for comparisons
   */
  private normalizeMimeType(mimeType: string): string {
    return mimeType.toLowerCase().split(";")[0].trim();
  }

  /**
   * Normalize the internal preference key for a MIME type
   */
  private getMimePreferenceKey(mimeType: string): string {
    return `mime:${this.normalizeMimeType(mimeType)}`;
  }

  /**
   * Normalize the internal preference key for a file extension
   */
  private getExtensionPreferenceKey(extension: string): string {
    return `ext:${this.normalizeExtension(extension)}`;
  }

  /**
   * Get the file extension from a path (lowercase, without dot)
   */
  private getExtension(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return ext.startsWith(".") ? ext.slice(1) : ext;
  }

  /**
   * Resolve file metadata used for matching and preference lookup
   */
  private async getFileContext(filePath: string): Promise<{
    fullPath: string;
    isDirectory: boolean;
    extension: string | undefined;
    mimeType: string | undefined;
    preferenceKeys: string[];
    canonicalPreferenceKey: string | undefined;
  }> {
    const fullPath = this.fsManager.resolvePath(filePath);
    const stats = await fs.stat(fullPath);
    const isDirectory = stats.isDirectory();

    if (isDirectory) {
      return {
        fullPath,
        isDirectory: true,
        extension: undefined,
        mimeType: undefined,
        preferenceKeys: [FileOpenManager.DIRECTORY_PREFERENCE_KEY],
        canonicalPreferenceKey: FileOpenManager.DIRECTORY_PREFERENCE_KEY,
      };
    }

    const extension = this.getExtension(filePath) || undefined;
    const mimeType = await this.detectMimeType(fullPath);
    const preferenceKeys: string[] = [];

    if (mimeType) {
      preferenceKeys.push(this.getMimePreferenceKey(mimeType));
    }

    if (extension) {
      preferenceKeys.push(this.getExtensionPreferenceKey(extension));
      preferenceKeys.push(extension);
    }

    return {
      fullPath,
      isDirectory: false,
      extension,
      mimeType,
      preferenceKeys,
      canonicalPreferenceKey: mimeType
        ? this.getMimePreferenceKey(mimeType)
        : extension
          ? this.getExtensionPreferenceKey(extension)
          : undefined,
    };
  }

  /**
   * Lazily create the shared WASMagic MIME detector
   */
  private getMimeDetector(): Promise<WASMagic> {
    if (!this.mimeDetectorPromise) {
      this.mimeDetectorPromise = WASMagic.create();
    }

    return this.mimeDetectorPromise;
  }

  /**
   * Detect the MIME type from file contents
   */
  private async detectMimeType(fullPath: string): Promise<string | undefined> {
    let handle: fs.FileHandle | undefined;

    try {
      handle = await fs.open(fullPath, "r");
      const buffer = Buffer.alloc(FileOpenManager.MIME_DETECTION_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);

      if (bytesRead === 0) {
        return undefined;
      }

      const magic = await this.getMimeDetector();
      return this.normalizeMimeType(
        magic.detect(buffer.subarray(0, bytesRead)),
      );
    } catch (error) {
      log.warn(`Failed to detect MIME type for ${fullPath}:`, error);
      return undefined;
    } finally {
      await handle?.close();
    }
  }

  /**
   * Get installed apps that expose file handlers
   */
  private getInstalledFileHandlers(): Array<{
    app: RuntimeAppManifest;
    handler: FileHandlerConfig;
  }> {
    const handlers: Array<{
      app: RuntimeAppManifest;
      handler: FileHandlerConfig;
    }> = [];

    for (const app of this.packageManager.getInstalledApps()) {
      for (const handler of app.fileHandlers ?? []) {
        handlers.push({ app, handler });
      }
    }

    return handlers;
  }

  /**
   * Check whether a handler supports a file extension
   */
  private handlerSupportsExtension(
    handler: FileHandlerConfig,
    extension: string,
  ): boolean {
    return (
      handler.extensions?.some(
        (candidate) => this.normalizeExtension(candidate) === extension,
      ) ?? false
    );
  }

  /**
   * Score a MIME pattern match for sorting
   */
  private getMimeMatchScore(
    handler: FileHandlerConfig,
    mimeType: string,
  ): number {
    let bestScore = 0;

    for (const candidate of handler.mimeTypes ?? []) {
      const normalizedCandidate = this.normalizeMimeType(candidate);

      if (normalizedCandidate === mimeType) {
        bestScore = Math.max(bestScore, 8);
        continue;
      }

      if (
        normalizedCandidate.endsWith("/*") &&
        mimeType.startsWith(normalizedCandidate.slice(0, -1))
      ) {
        bestScore = Math.max(bestScore, 6);
      }
    }

    return bestScore;
  }

  /**
   * Get matching handlers for the provided file metadata
   */
  private getMatchingHandlers(criteria: {
    extension?: string;
    mimeType?: string;
    isDirectory?: boolean;
  }): Array<{
    app: RuntimeAppManifest;
    handler: FileHandlerConfig;
    score: number;
  }> {
    const extension = criteria.extension
      ? this.normalizeExtension(criteria.extension)
      : undefined;
    const mimeType = criteria.mimeType
      ? this.normalizeMimeType(criteria.mimeType)
      : undefined;

    const matches: Array<{
      app: RuntimeAppManifest;
      handler: FileHandlerConfig;
      score: number;
    }> = [];

    for (const { app, handler } of this.getInstalledFileHandlers()) {
      if (criteria.isDirectory) {
        if (!handler.directories) {
          continue;
        }

        matches.push({ app, handler, score: 100 });
        continue;
      }

      let score = 0;

      if (extension && this.handlerSupportsExtension(handler, extension)) {
        score += 2;
      }

      if (mimeType) {
        score += this.getMimeMatchScore(handler, mimeType);
      }

      if (score === 0) {
        continue;
      }

      matches.push({ app, handler, score });
    }

    return matches.sort((left, right) => right.score - left.score);
  }

  /**
   * Resolve the handler app ID for a file or directory
   */
  private resolveUserPreference(preferenceKeys: string[]): string | undefined {
    for (const key of preferenceKeys) {
      const preferredAppId = this.userPreferences.get(key);
      if (
        preferredAppId &&
        this.packageManager.getAppManifest(preferredAppId)
      ) {
        return preferredAppId;
      }
    }

    return undefined;
  }

  /**
   * Resolve the handler app ID for a file or directory
   */
  private resolveHandler(fileContext: {
    isDirectory: boolean;
    extension: string | undefined;
    mimeType: string | undefined;
    preferenceKeys: string[];
  }): {
    appId: string | undefined;
    mimeType: string | undefined;
  } {
    if (fileContext.isDirectory) {
      return {
        appId: this.getMatchingHandlers({ isDirectory: true })[0]?.app.id,
        mimeType: undefined,
      };
    }

    const preferredAppId = this.resolveUserPreference(
      fileContext.preferenceKeys,
    );
    if (preferredAppId) {
      return { appId: preferredAppId, mimeType: fileContext.mimeType };
    }

    const appId = this.getMatchingHandlers({
      extension: fileContext.extension,
      mimeType: fileContext.mimeType,
    })[0]?.app.id;

    return { appId, mimeType: fileContext.mimeType };
  }

  /**
   * Get the default handler app for a file path
   */
  async getHandlerForPath(filePath: string): Promise<string | undefined> {
    const fileContext = await this.getFileContext(filePath);
    return this.resolveHandler(fileContext).appId;
  }

  /**
   * Set user preference for a file path
   */
  async setDefaultHandler(filePath: string, appId: string): Promise<void> {
    const fileContext = await this.getFileContext(filePath);
    const preferenceKey = fileContext.canonicalPreferenceKey;

    if (!preferenceKey) {
      throw new Error(`Unable to determine file type for ${filePath}`);
    }

    for (const key of fileContext.preferenceKeys) {
      this.userPreferences.delete(key);
    }

    this.userPreferences.set(preferenceKey, appId);
    await this.saveUserPreferences();
  }

  /**
   * Remove user preference for a file path (revert to default)
   */
  async removeDefaultHandler(filePath: string): Promise<void> {
    const fileContext = await this.getFileContext(filePath);

    for (const key of fileContext.preferenceKeys) {
      this.userPreferences.delete(key);
    }

    await this.saveUserPreferences();
  }

  /**
   * Helper to resolve localized app name to string
   */
  private getAppName(name: string | Record<string, string>): string {
    if (typeof name === "string") {
      return name;
    }
    return name.en || Object.values(name)[0] || "Unknown App";
  }

  /**
   * Get all apps that can handle a specific file path
   */
  async getSupportedHandlers(filePath: string): Promise<FileHandlerInfo[]> {
    const fileContext = await this.getFileContext(filePath);
    const handlers = new Map<string, FileHandlerInfo>();

    for (const { app, handler } of this.getMatchingHandlers({
      extension: fileContext.extension,
      mimeType: fileContext.mimeType,
      isDirectory: fileContext.isDirectory,
    })) {
      if (handlers.has(app.id)) {
        continue;
      }

      handlers.set(app.id, {
        appId: app.id,
        appName: this.getAppName(app.name),
        handlerName: handler.name,
        icon: app.icon,
      });
    }

    return Array.from(handlers.values());
  }

  /**
   * Get all file type associations
   */
  getAllAssociations(): Record<
    string,
    { default: string | undefined; userOverride: string | undefined }
  > {
    const result: Record<
      string,
      { default: string | undefined; userOverride: string | undefined }
    > = {};

    for (const { app, handler } of this.getInstalledFileHandlers()) {
      if (
        handler.directories &&
        !result[FileOpenManager.DIRECTORY_PREFERENCE_KEY]
      ) {
        result[FileOpenManager.DIRECTORY_PREFERENCE_KEY] = {
          default: app.id,
          userOverride: this.userPreferences.get(
            FileOpenManager.DIRECTORY_PREFERENCE_KEY,
          ),
        };
      }

      for (const mimeType of handler.mimeTypes ?? []) {
        const key = this.getMimePreferenceKey(mimeType);

        if (!result[key]) {
          result[key] = {
            default: app.id,
            userOverride: this.userPreferences.get(key),
          };
        }
      }

      for (const extension of handler.extensions ?? []) {
        const key = this.getExtensionPreferenceKey(extension);

        if (!result[key]) {
          result[key] = {
            default: app.id,
            userOverride: this.userPreferences.get(key),
          };
        }
      }
    }

    for (const [ext, appId] of this.userPreferences) {
      if (!result[ext]) {
        result[ext] = {
          default: undefined,
          userOverride: appId,
        };
      }
    }

    return result;
  }

  /**
   * Open a file with its default handler
   */
  async openFile(filePath: string): Promise<FileOpenResult> {
    try {
      const fileContext = await this.getFileContext(filePath);
      const { appId: handlerAppId, mimeType } =
        this.resolveHandler(fileContext);

      if (!handlerAppId) {
        const extension = this.getExtension(filePath);
        return {
          success: false,
          error: `No handler found for ${
            fileContext.isDirectory
              ? "directories"
              : mimeType
                ? `MIME type ${mimeType}`
                : extension
                  ? `extension .${extension}`
                  : "this file"
          }`,
        };
      }

      // Check if app is installed
      const manifest = this.packageManager.getAppManifest(handlerAppId);
      if (!manifest) {
        return {
          success: false,
          error: `Handler app ${handlerAppId} is not installed`,
        };
      }

      // Launch the app (or focus if already running)
      const instance = this.processManager.getAppInstance(handlerAppId);
      if (!instance) {
        // App not running - launch with file path as launch argument
        await this.processManager.launchApp(handlerAppId, undefined, [
          filePath,
        ]);
      } else {
        // App already running - notify via event (app is already subscribed)
        const viewIds = this.viewManager.getViewsByAppId(handlerAppId);
        for (const viewId of viewIds) {
          this.notifySubscriber(viewId, "opened", {
            path: filePath,
            isDirectory: fileContext.isDirectory,
            appId: handlerAppId,
          });
        }
      }

      return {
        success: true,
        appId: handlerAppId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Open a file with a specific app
   */
  async openFileWith(filePath: string, appId: string): Promise<FileOpenResult> {
    try {
      // Resolve masked path to full filesystem path
      const fullPath = this.fsManager.resolvePath(filePath);

      // Check if file exists and get stats
      const stats = await fs.stat(fullPath);
      const isDirectory = stats.isDirectory();

      // Check if app is installed
      const manifest = this.packageManager.getAppManifest(appId);
      if (!manifest) {
        return {
          success: false,
          error: `App ${appId} is not installed`,
        };
      }

      // Launch the app (or focus if already running)
      const instance = this.processManager.getAppInstance(appId);
      if (!instance) {
        // App not running - launch with file path as launch argument
        await this.processManager.launchApp(appId, undefined, [filePath]);
      } else {
        // App already running - notify via event (app is already subscribed)
        const viewIds = this.viewManager.getViewsByAppId(appId);
        for (const viewId of viewIds) {
          this.notifySubscriber(viewId, "opened", {
            path: filePath,
            isDirectory,
            appId,
          });
        }
      }

      return {
        success: true,
        appId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
