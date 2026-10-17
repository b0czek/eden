import type {
  FileHandlerInfo,
  FileOpenedEvent,
  FilesystemLocation,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import type { TargetedNotification } from "../controllers/events";
import { scopedEvent } from "../events/scoped";
import {
  DIRECTORY_ASSOCIATION_KEY,
  DIRECTORY_PREFERENCE_KEY,
  getAssociationKind,
  getExtension,
  getExtensionPreferenceKey,
  getInstalledFileHandlers,
  getMatchingHandlers,
  getMimePreferenceKey,
  getPublicPreferenceKey,
} from "./handlers";
import type {
  FileOpenAssociations,
  FileOpenCatalog,
  FileOpenFilesystem,
  FileOpenI18n,
  FileOpenProcesses,
  FileOpenViews,
} from "./ports";

/** Expected failures remain in the error channel; thrown defects are not converted. */
const fileOpenFailure = (message: string) =>
  Object.assign(new Error(message), { _tag: "FileOpenFailure" as const });

interface FileOpenDependencies {
  associations: FileOpenAssociations;
  catalog: FileOpenCatalog;
  processes: FileOpenProcesses;
  views: FileOpenViews;
  filesystem: FileOpenFilesystem;
  i18n: FileOpenI18n;
}

export function createFileOpen({
  associations,
  catalog,
  processes,
  views,
  filesystem,
  i18n,
}: FileOpenDependencies) {
  return Effect.gen(function* () {
    const opened = yield* scopedEvent<TargetedNotification<FileOpenedEvent>>();

    function getFileContext(location: FilesystemLocation) {
      return Effect.map(filesystem.inspect(location), (metadata) => {
        const extension = metadata.isDirectory
          ? undefined
          : getExtension(location.path) || undefined;
        const preferenceKeys = metadata.isDirectory
          ? [DIRECTORY_ASSOCIATION_KEY]
          : [
              ...(metadata.mimeType
                ? [getMimePreferenceKey(metadata.mimeType)]
                : []),
              ...(extension ? [getExtensionPreferenceKey(extension)] : []),
            ];
        return { ...metadata, extension, preferenceKeys };
      });
    }

    function resolveHandler(context: {
      isDirectory: boolean;
      extension?: string;
      mimeType?: string;
      preferenceKeys: string[];
    }): string | undefined {
      const matching = getMatchingHandlers(catalog, context);
      if (!context.isDirectory) {
        const matchingAppIds = new Set(matching.map(({ app }) => app.id));
        for (const key of context.preferenceKeys) {
          const preferred = associations.get(key)?.appId;
          if (preferred && matchingAppIds.has(preferred)) return preferred;
        }
      }
      return matching[0]?.app.id;
    }

    function getHandlerForPath(location: FilesystemLocation) {
      return Effect.map(getFileContext(location), resolveHandler);
    }

    function setDefaultHandler(
      location: FilesystemLocation,
      appId: string,
    ): Effect.Effect<void, Error> {
      return Effect.gen(function* () {
        const context = yield* getFileContext(location);
        const preferenceKey = context.preferenceKeys[0];
        if (!preferenceKey)
          return yield* Effect.fail(
            new Error(`Unable to determine file type for ${location}`),
          );
        for (const key of context.preferenceKeys)
          yield* associations.remove(key);
        yield* associations.set(preferenceKey, {
          appId,
          kind: getAssociationKind(preferenceKey),
        });
      }).pipe(Effect.uninterruptible);
    }

    function removeDefaultHandler(location: FilesystemLocation) {
      return Effect.gen(function* () {
        const context = yield* getFileContext(location);
        for (const key of context.preferenceKeys)
          yield* associations.remove(key);
      });
    }

    function getSupportedHandlers(location: FilesystemLocation) {
      return Effect.gen(function* () {
        const context = yield* getFileContext(location);
        const locale = yield* i18n.getLocale();
        const handlers = new Map<string, FileHandlerInfo>();
        for (const { app, handler } of getMatchingHandlers(catalog, context)) {
          if (handlers.has(app.id)) continue;
          const name = app.name;
          const appName =
            typeof name === "string"
              ? name
              : name[locale] ||
                name.en ||
                Object.values(name)[0] ||
                "Unknown App";
          handlers.set(app.id, {
            appId: app.id,
            appName,
            handlerName: handler.name,
            icon: app.icon,
          });
        }
        return Array.from(handlers.values());
      });
    }

    function getAllAssociations(): Record<
      string,
      { default: string | undefined; userOverride: string | undefined }
    > {
      const result: Record<
        string,
        { default: string | undefined; userOverride: string | undefined }
      > = {};
      for (const { app, handler } of getInstalledFileHandlers(catalog)) {
        if (handler.directories && !result[DIRECTORY_PREFERENCE_KEY]) {
          result[DIRECTORY_PREFERENCE_KEY] = {
            default: app.id,
            userOverride: associations.get(DIRECTORY_ASSOCIATION_KEY)?.appId,
          };
        }
        for (const key of [
          ...(handler.mimeTypes ?? []).map(getMimePreferenceKey),
          ...(handler.extensions ?? []).map(getExtensionPreferenceKey),
        ]) {
          const publicKey = getPublicPreferenceKey(key);
          if (!result[publicKey]) {
            result[publicKey] = {
              default: app.id,
              userOverride: associations.get(key)?.appId,
            };
          }
        }
      }
      for (const [key, association] of Object.entries(
        associations.list({ kindPrefix: "file." }),
      )) {
        const publicKey = getPublicPreferenceKey(key);
        if (!result[publicKey]) {
          result[publicKey] = {
            default: undefined,
            userOverride: association.appId,
          };
        }
      }
      return result;
    }

    function launchOrNotify(
      location: FilesystemLocation,
      appId: string,
      isDirectory: boolean,
    ) {
      return Effect.gen(function* () {
        if (!processes.isRunning(appId)) {
          yield* processes.launch(appId, location);
          return;
        }
        const focusViewId = views.getViewsByAppId(appId).at(-1);
        if (focusViewId !== undefined) {
          views.showView(focusViewId);
          views.focusView(focusViewId);
        }
        opened.emit({
          viewIds: views.getViewsByAppId(appId),
          payload: { location: { ...location }, isDirectory, appId },
        });
      });
    }

    const openFile = Effect.fn(function* (location: FilesystemLocation) {
      const context = yield* getFileContext(location).pipe(
        Effect.mapError((error) => fileOpenFailure(error.message)),
      );
      const appId = resolveHandler(context);
      if (!appId)
        return yield* Effect.fail(
          fileOpenFailure(
            `No handler found for ${
              context.isDirectory
                ? "directories"
                : context.mimeType
                  ? `MIME type ${context.mimeType}`
                  : context.extension
                    ? `extension .${context.extension}`
                    : "this file"
            }`,
          ),
        );
      if (!catalog.getApp(appId))
        return yield* Effect.fail(
          fileOpenFailure(`Handler app ${appId} is not installed`),
        );
      yield* launchOrNotify(location, appId, context.isDirectory).pipe(
        Effect.mapError((error) => fileOpenFailure(error.message)),
      );
      return { appId };
    });

    const openFileWith = Effect.fn(function* (
      location: FilesystemLocation,
      appId: string,
    ) {
      const isDirectory = yield* filesystem
        .isDirectory(location)
        .pipe(Effect.mapError((error) => fileOpenFailure(error.message)));
      if (!catalog.getApp(appId))
        return yield* Effect.fail(
          fileOpenFailure(`App ${appId} is not installed`),
        );
      yield* launchOrNotify(location, appId, isDirectory).pipe(
        Effect.mapError((error) => fileOpenFailure(error.message)),
      );
      return { appId };
    });

    return {
      opened,
      getHandlerForPath,
      setDefaultHandler,
      removeDefaultHandler,
      getSupportedHandlers,
      getAllAssociations,
      openFile,
      openFileWith,
    };
  });
}

export type FileOpen = Effect.Success<ReturnType<typeof createFileOpen>>;
