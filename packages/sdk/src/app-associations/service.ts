import type {
  AppAssociation,
  AppAssociationStore,
  RuntimeAppManifest,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import * as v from "valibot";
import { log } from "../logging";
import type { AppAssociationCatalog, AppAssociationStorage } from "./ports";
import { appAssociationSchema } from "./schemas";

export interface AppAssociationListOptions {
  kindPrefix?: string;
}

interface AppAssociationsDependencies {
  catalog: AppAssociationCatalog;
  storage: AppAssociationStorage;
}

function isValidStoredAssociation(
  association: unknown,
): association is AppAssociation {
  const valid = v.safeParse(appAssociationSchema, association).success;

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
    const mutations = yield* Semaphore.make(1);

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
                    isValidStoredAssociation(association),
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

    function persistMutation(
      mutate: (next: Map<string, AppAssociation>) => void,
    ) {
      return mutations.withPermit(
        Effect.gen(function* () {
          const next = new Map(associations);
          const content = yield* Effect.try({
            try: () => {
              mutate(next);
              const store: AppAssociationStore = {
                version: 1,
                associations: Object.fromEntries(next),
              };
              return `${JSON.stringify(store, null, 2)}\n`;
            },
            catch: (error) =>
              error instanceof Error ? error : new Error(String(error)),
          });
          yield* storage.write(content);
          associations = next;
        }).pipe(Effect.uninterruptible),
      );
    }

    function set(key: string, association: AppAssociation) {
      return persistMutation((next) => {
        next.set(key, { ...association });
      });
    }

    function remove(key: string) {
      return persistMutation((next) => {
        next.delete(key);
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
