import * as fs from "fs/promises";
import * as path from "path";
import { injectable, inject } from "tsyringe";
import { PackageManager } from "../package-manager";
import { ProcessManager } from "../process-manager";
import { ViewManager } from "../view-manager";
import { IPCBridge, CommandRegistry, EdenNamespace, EdenEmitter } from "../ipc";
import { FileOpenHandler } from "./FileOpenHandler";

/**
 * Result of opening a file
 */
export interface FileOpenResult {
  success: boolean;
  appId?: string;
  error?: string;
}

/**
 * Information about a file handler
 */
export interface FileHandlerInfo {
  appId: string;
  appName: string;
  handlerName?: string;
  icon?: string;
}

/**
 * Events emitted by the FileOpenManager
 */
interface FileNamespaceEvents {
  "opened": { path: string; isDirectory: boolean; appId: string };
}

/**
 * FileOpenManager
 * 
 * Manages file type associations and handles opening files with appropriate applications.
 */
@injectable()
@EdenNamespace("file")
export class FileOpenManager extends EdenEmitter<FileNamespaceEvents> {
  private userDirectory: string;
  private preferencesPath: string;
  private fileOpenHandler: FileOpenHandler;
  
  // Built-in default extension -> app ID mappings
  private defaultRegistry: Map<string, string> = new Map();
  
  // User override preferences (extension -> app ID)
  private userPreferences: Map<string, string> = new Map();
  
  // Special key for directories
  private static readonly DIRECTORY_KEY = "__directory__";

  constructor(
    @inject("userDirectory") userDirectory: string,
    @inject("PackageManager") private packageManager: PackageManager,
    @inject("ProcessManager") private processManager: ProcessManager,
    @inject("ViewManager") private viewManager: ViewManager,
    @inject("IPCBridge") ipcBridge: IPCBridge,
    @inject("CommandRegistry") commandRegistry: CommandRegistry
  ) {
    super(ipcBridge);
    this.userDirectory = userDirectory;
    this.preferencesPath = path.join(userDirectory, "file-associations.json");
    
    this.initializeDefaultRegistry();
    
    // Create and register handler
    this.fileOpenHandler = new FileOpenHandler(this);
    commandRegistry.registerManager(this.fileOpenHandler);
  }

  /**
   * Initialize with user preferences loaded from disk
   */
  async initialize(): Promise<void> {
    await this.loadUserPreferences();
    console.log(`FileOpenManager initialized with ${this.userPreferences.size} user preferences`);
  }

  /**
   * Set up built-in default handlers
   */
  private initializeDefaultRegistry(): void {
    // Directories open in file manager
    this.defaultRegistry.set(FileOpenManager.DIRECTORY_KEY, "com.eden.files");
    
    // Text files
    const textExtensions = ["txt", "md", "json", "js", "ts", "jsx", "tsx", "css", "html", "xml", "yaml", "yml", "toml", "ini", "cfg", "conf", "log"];
    for (const ext of textExtensions) {
      this.defaultRegistry.set(ext, "com.eden.files"); // Fallback to file manager for now
    }
    
    // Image files
    const imageExtensions = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"];
    for (const ext of imageExtensions) {
      this.defaultRegistry.set(ext, "com.eden.files"); // Fallback to file manager for now
    }
    
    // Eden packages
    this.defaultRegistry.set("edenite", "com.eden.files"); // Could be a package installer
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
   * Get the file extension from a path (lowercase, without dot)
   */
  private getExtension(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return ext.startsWith(".") ? ext.slice(1) : ext;
  }

  /**
   * Get the handler app ID for a file path
   */
  getHandler(filePath: string, isDirectory: boolean = false): string | undefined {
    const key = isDirectory ? FileOpenManager.DIRECTORY_KEY : this.getExtension(filePath);
    
    // User preference takes priority
    if (this.userPreferences.has(key)) {
      return this.userPreferences.get(key);
    }
    
    // Fall back to default registry
    return this.defaultRegistry.get(key);
  }

  /**
   * Get handler for a specific extension
   */
  getHandlerForExtension(extension: string): string | undefined {
    const ext = extension.toLowerCase().replace(/^\./, "");
    
    // User preference takes priority
    if (this.userPreferences.has(ext)) {
      return this.userPreferences.get(ext);
    }
    
    // Fall back to default registry
    return this.defaultRegistry.get(ext);
  }

  /**
   * Set user preference for a file extension
   */
  async setDefaultHandler(extension: string, appId: string): Promise<void> {
    const ext = extension.toLowerCase().replace(/^\./, "");
    this.userPreferences.set(ext, appId);
    await this.saveUserPreferences();
  }

  /**
   * Remove user preference for a file extension (revert to default)
   */
  async removeDefaultHandler(extension: string): Promise<void> {
    const ext = extension.toLowerCase().replace(/^\./, "");
    this.userPreferences.delete(ext);
    await this.saveUserPreferences();
  }

  /**
   * Get all apps that can handle a specific extension
   */
  getSupportedHandlers(extension: string): FileHandlerInfo[] {
    const ext = extension.toLowerCase().replace(/^\./, "");
    const handlers: FileHandlerInfo[] = [];
    
    // Check all installed apps for file handlers
    const apps = this.packageManager.getInstalledApps();
    
    for (const app of apps) {
      if (app.fileHandlers) {
        for (const handler of app.fileHandlers) {
          if (handler.extensions.map(e => e.toLowerCase()).includes(ext)) {
            handlers.push({
              appId: app.id,
              appName: app.name,
              handlerName: handler.name,
              icon: handler.icon || app.icon,
            });
          }
        }
      }
    }
    
    // Also add default handler if it exists and isn't already in the list
    const defaultHandler = this.defaultRegistry.get(ext);
    if (defaultHandler && !handlers.some(h => h.appId === defaultHandler)) {
      const app = this.packageManager.getAppManifest(defaultHandler);
      if (app) {
        handlers.push({
          appId: app.id,
          appName: app.name,
        });
      }
    }
    
    return handlers;
  }

  /**
   * Get all file type associations
   */
  getAllAssociations(): Record<string, { default: string | undefined; userOverride: string | undefined }> {
    const result: Record<string, { default: string | undefined; userOverride: string | undefined }> = {};
    
    // Add all default registry entries
    for (const [ext, appId] of this.defaultRegistry) {
      result[ext] = {
        default: appId,
        userOverride: this.userPreferences.get(ext),
      };
    }
    
    // Add any user preferences that aren't in default registry
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
      // Check if path exists and get stats
      const fullPath = path.resolve(filePath);
      const stats = await fs.stat(fullPath);
      const isDirectory = stats.isDirectory();
      
      // Get handler
      const handlerAppId = this.getHandler(filePath, isDirectory);
      
      if (!handlerAppId) {
        return {
          success: false,
          error: `No handler found for ${isDirectory ? "directories" : `extension .${this.getExtension(filePath)}`}`,
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
        await this.processManager.launchApp(handlerAppId);
      }
      
      // Notify only the target app's views
      const viewIds = this.viewManager.getViewsByAppId(handlerAppId);
      for (const viewId of viewIds) {
        this.notifySubscriber(viewId, "opened", { path: fullPath, isDirectory, appId: handlerAppId });
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
      const fullPath = path.resolve(filePath);
      
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
        await this.processManager.launchApp(appId);
      }
      
      // Notify only the target app's views
      const viewIds = this.viewManager.getViewsByAppId(appId);
      for (const viewId of viewIds) {
        this.notifySubscriber(viewId, "opened", { path: fullPath, isDirectory, appId });
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
