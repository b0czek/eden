import type {
  AppAssociation,
  FileHandlerConfig,
  FilesystemLocation,
  RuntimeAppManifest,
} from "@edenapp/types";
import type * as Effect from "effect/Effect";
import type {
  OperationReporter,
  OperationTask,
} from "../operations/OperationTask";

/** Association capabilities needed to select and persist file handlers. */
export interface FileOpenAssociations {
  get(key: string): AppAssociation | undefined;
  list(options?: { kindPrefix?: string }): Record<string, AppAssociation>;
  set(key: string, association: AppAssociation): Effect.Effect<void, Error>;
  remove(key: string): Effect.Effect<void, Error>;
}

export interface FileOpenCatalog {
  listApps(options: { showHidden: true }): RuntimeAppManifest[];
  dlcsForHost(appId: string): Array<{ fileHandlers?: FileHandlerConfig[] }>;
  getApp(appId: string): RuntimeAppManifest | undefined;
}

export interface FileOpenFilesystem {
  inspect(location: FilesystemLocation): Effect.Effect<
    {
      isDirectory: boolean;
      mimeType?: string;
    },
    Error
  >;
  isDirectory(location: FilesystemLocation): Effect.Effect<boolean, Error>;
}

export interface FileOpenProcesses {
  isRunning(appId: string): boolean;
  launch(
    appId: string,
    location: FilesystemLocation,
  ): Effect.Effect<void, Error>;
}

export interface FileOpenViews {
  getViewsByAppId(appId: string): number[];
  showView(viewId: number): void;
  focusView(viewId: number): void;
}

export interface FileOpenI18n {
  getLocale(): Effect.Effect<string, Error>;
}

/** The retained operation owner interprets work only after accepting its task. */
export interface FileOpenOperationBoundary {
  prepareVolumeOperation<R>(
    volumes: string[],
    run: (reporter: OperationReporter) => Promise<R>,
  ): OperationTask<R>;
  run<A, E>(work: Effect.Effect<A, E>): Promise<A>;
}
