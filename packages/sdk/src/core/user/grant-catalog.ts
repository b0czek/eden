import type {
  RuntimeAppManifest,
  UserGrantOption,
  UserGrantOptionsResponse,
} from "@edenapp/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { PackageCatalog } from "../../applications/packages/catalog";
import { createEvent, type Event } from "../events/event";
import { SettingsPanels } from "../settings/panels/service";

export interface GrantCatalog {
  getOptions: () => UserGrantOptionsResponse;
  invalidate: () => void;
  changed: Event<{ revision: number }>;
  dispose: () => void;
}

export const GrantCatalog = Context.Service<"eden/GrantCatalog", GrantCatalog>(
  "eden/GrantCatalog",
);

interface GrantCatalogEvents {
  "grant-options-changed": { revision: number };
}
export const GrantCatalogLive = Layer.effect(
  GrantCatalog,
  Effect.acquireRelease(
    Effect.gen(function* () {
      const packageCatalog = yield* PackageCatalog;
      const settingsPanels = yield* SettingsPanels;
      const changed =
        createEvent<GrantCatalogEvents["grant-options-changed"]>();
      let active = true;
      let revision = 1;
      let invalidationQueued = false;

      function getOptions(): UserGrantOptionsResponse {
        const options = new Map<string, UserGrantOption>();
        const add = (option: UserGrantOption) => {
          if (!option.grant || options.has(option.grant)) return;
          options.set(option.grant, structuredClone(option));
        };

        for (const app of packageCatalog.allApps()) {
          addAppOptions(app, add);
        }
        for (const option of settingsPanels.listGrantOptions()) add(option);

        return {
          revision,
          options: Array.from(options.values()).sort((a, b) =>
            a.grant.localeCompare(b.grant),
          ),
        };
      }
      function addAppOptions(
        app: RuntimeAppManifest,
        add: (option: UserGrantOption) => void,
      ): void {
        if (!app.isCore && !app.isRestricted) {
          add({
            grant: `apps/launch/${app.id}`,
            kind: "app-launch",
            label: app.name,
            description: app.description,
            ownerId: app.id,
            ownerLabel: app.name,
          });
        }

        for (const grant of app.resolvedGrants) {
          const id = grant.scope === "preset" ? grant.preset : grant.id;
          if (!id) continue;
          add({
            grant:
              grant.scope === "preset" ? `preset/${id}` : `app/${app.id}/${id}`,
            kind: grant.scope === "preset" ? "preset" : "app-feature",
            label: grant.label ?? id,
            description: grant.description,
            ownerId: app.id,
            ownerLabel: app.name,
          });
        }
      }
      function invalidate(): void {
        if (invalidationQueued) return;
        invalidationQueued = true;
        queueMicrotask(() => {
          invalidationQueued = false;
          if (!active) return;
          revision += 1;
          changed.emit({ revision });
        });
      }
      return {
        getOptions,
        invalidate,
        changed,
        dispose: () => {
          active = false;
          changed.dispose();
        },
      };
    }),
    (value) => Effect.sync(value.dispose),
  ),
);
