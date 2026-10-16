import type {
  AppAssociation,
  AppAssociationStore,
  RuntimeAppManifest,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import { log } from "../logging";
import type { AppAssociationCatalog, AppAssociationStorage } from "./ports";

export interface AppAssociationListOptions {
  kindPrefix?: string;
}

interface AppAssociationsDependencies {
  catalog: AppAssociationCatalog;
  storage: AppAssociationStorage;
}

function validateKey(key: string): void {
  if (!key.trim()) throw new Error("Association key is required");
}

function isValidAssociation(
  association: unknown,
): association is AppAssociation {
  if (!association || typeof association !== "object") return false;
  const candidate = association as Partial<AppAssociation>;
  const valid =
    typeof candidate.appId === "string" &&
    candidate.appId.trim().length > 0 &&
    typeof candidate.kind === "string" &&
    candidate.kind.trim().length > 0 &&
    (candidate.label === undefined || typeof candidate.label === "string");

  if (!valid) log.warn("Ignoring invalid app association entry");
  return valid;
}

export function createAppAssociations({
  catalog,
  storage,
}: AppAssociationsDependencies) {
  return Effect.gen(function* () {
    let associations = new Map<string, AppAssociation>();
    let initialized = false;

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        associations.clear();
        initialized = false;
      }),
    );

    function initialize() {
      return Effect.gen(function* () {
        if (initialized) return;
        initialized = true;

        const content = yield* Effect.match(storage.read(), {
          onFailure: () => undefined,
          onSuccess: (value) => value,
        });
        try {
          const store = JSON.parse(
            content ?? "",
          ) as Partial<AppAssociationStore>;
          associations =
            store.version === 1 &&
            store.associations &&
            typeof store.associations === "object"
              ? new Map(
                  Object.entries(store.associations).filter(([, association]) =>
                    isValidAssociation(association),
                  ),
                )
              : new Map();
        } catch {
          associations = new Map();
        }
      });
    }

    function get(key: string): AppAssociation | undefined {
      const association = associations.get(key);
      return association ? { ...association } : undefined;
    }

    function resolve(
      key: string,
      matches: (app: RuntimeAppManifest) => boolean,
    ): AppAssociation[] {
      const association = get(key);
      if (association) {
        const app = catalog.getLaunchableApp(association.appId);
        if (app && matches(app)) return [association];
      }

      return catalog
        .listApps({ showHidden: true })
        .filter(matches)
        .map((app) => ({ appId: app.id, kind: "provider" }));
    }

    function persistMutation(mutate: () => void) {
      return Effect.gen(function* () {
        const content = yield* Effect.try({
          try: () => {
            mutate();
            const store: AppAssociationStore = {
              version: 1,
              associations: Object.fromEntries(associations),
            };
            return `${JSON.stringify(store, null, 2)}\n`;
          },
          catch: (error) =>
            error instanceof Error ? error : new Error(String(error)),
        });
        yield* storage.write(content);
      }).pipe(Effect.uninterruptible);
    }

    function set(key: string, association: AppAssociation) {
      return persistMutation(() => {
        validateKey(key);
        if (!isValidAssociation(association))
          throw new Error("Invalid app association");
        associations.set(key, { ...association });
      });
    }

    function remove(key: string) {
      return persistMutation(() => {
        validateKey(key);
        associations.delete(key);
      });
    }

    function list(
      options: AppAssociationListOptions = {},
    ): Record<string, AppAssociation> {
      const result: Record<string, AppAssociation> = {};
      for (const [key, association] of associations) {
        if (
          options.kindPrefix &&
          !association.kind.startsWith(options.kindPrefix)
        )
          continue;
        result[key] = { ...association };
      }
      return result;
    }

    return { initialize, get, resolve, set, remove, list };
  });
}

export type AppAssociations = Effect.Success<
  ReturnType<typeof createAppAssociations>
>;
