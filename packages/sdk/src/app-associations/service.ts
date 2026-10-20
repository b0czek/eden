import type {
  AppAssociation,
  AppAssociationStore,
  RuntimeAppManifest,
} from "@edenapp/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as v from "valibot";
import { log } from "../logging";
import { PackageCatalog } from "../packages/catalog";
import type { AppAssociationStorageWriteError } from "./errors";
import { AppAssociationStorage } from "./ports";
import { appAssociationSchema } from "./schemas";

export interface AppAssociations {
  initialize: () => Effect.Effect<void>;
  get: (key: string) => AppAssociation | undefined;
  resolve: (
    key: string,
    matches: (app: RuntimeAppManifest) => boolean,
  ) => AppAssociation[];
  set: (
    key: string,
    association: AppAssociation,
  ) => Effect.Effect<void, AppAssociationStorageWriteError>;
  remove: (key: string) => Effect.Effect<void, AppAssociationStorageWriteError>;
  list: (options?: AppAssociationListOptions) => Record<string, AppAssociation>;
}

export const AppAssociations = Context.Service<
  "eden/AppAssociations",
  AppAssociations
>("eden/AppAssociations");

export interface AppAssociationListOptions {
  kindPrefix?: string;
}

function isValidStoredAssociation(
  association: unknown,
): association is AppAssociation {
  const valid = v.safeParse(appAssociationSchema, association).success;

  if (!valid) log.warn("Ignoring invalid app association entry");
  return valid;
}

export const AppAssociationsLive = Layer.effect(
  AppAssociations,
  Effect.gen(function* () {
    const catalog = yield* PackageCatalog;
    const storage = yield* AppAssociationStorage;
    let associations = new Map<string, AppAssociation>();
    const mutations = yield* Semaphore.make(1);

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        associations.clear();
      }),
    );

    const initialization = yield* Effect.cached(
      Effect.gen(function* () {
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
      }),
    );

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
          const content = yield* Effect.sync(() => {
            mutate(next);
            const store: AppAssociationStore = {
              version: 1,
              associations: Object.fromEntries(next),
            };
            return `${JSON.stringify(store, null, 2)}\n`;
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

    return {
      initialize: () => initialization,
      get,
      resolve,
      set,
      remove,
      list,
    };
  }),
);
