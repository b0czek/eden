import type { DialogController } from "@edenapp/solid-kit/dialogs";
import { createResource, For } from "solid-js";
import { t } from "../i18n";

interface OpenWithDialogAppOption {
  appId: string;
  appName: string;
  isSuggested: boolean;
}

const appIconCache = new Map<string, string | undefined>();

const fetchAppIcon = async (appId: string): Promise<string | undefined> => {
  if (appIconCache.has(appId)) {
    return appIconCache.get(appId);
  }

  try {
    const result = await window.edenAPI.shellCommand("package/get-icon", {
      appId,
    });
    appIconCache.set(appId, result.icon);
    return result.icon;
  } catch (error) {
    console.warn(`Failed to fetch icon for ${appId}:`, error);
    appIconCache.set(appId, undefined);
    return undefined;
  }
};

interface OpenWithDialogOptions {
  dialogs: DialogController;
  itemName: string;
  apps: OpenWithDialogAppOption[];
  initialAppId?: string;
}

interface OpenWithDialogValue {
  appId?: string;
  setAsDefault: boolean;
}

interface OpenWithDialogResult {
  appId: string;
  setAsDefault: boolean;
}

const AppOptionIcon = (props: { appId: string; appName: string }) => {
  const [icon] = createResource(() => props.appId, fetchAppIcon);

  return (
    <div class="open-with-dialog-icon">
      {icon() && <img src={icon()} alt="" draggable={false} />}
    </div>
  );
};

export const openOpenWithDialog = async (
  options: OpenWithDialogOptions,
): Promise<OpenWithDialogResult | null> => {
  return options.dialogs.custom<
    OpenWithDialogValue,
    OpenWithDialogResult | null
  >({
    title: t("files.openWith"),
    message: `${t("files.chooseApp")}: ${options.itemName}`,
    size: "md",
    initialValue: {
      appId: options.initialAppId,
      setAsDefault: false,
    },
    initialCanSubmit: Boolean(options.initialAppId),
    cancelResult: null,
    render: (ctx) => (
      <div class="open-with-dialog">
        {options.apps.length === 0 ? (
          <p class="eden-form-help">{t("files.errors.noAppsAvailable")}</p>
        ) : (
          <div class="open-with-dialog-apps">
            <For each={options.apps}>
              {(app, index) => {
                return (
                  <button
                    type="button"
                    class="open-with-dialog-option"
                    classList={{
                      selected: ctx.value().appId === app.appId,
                    }}
                    ref={index() === 0 ? ctx.setInitialFocusRef : undefined}
                    onClick={() => {
                      ctx.setValue((current) => ({
                        ...current,
                        appId: app.appId,
                      }));
                      ctx.setCanSubmit(true);
                    }}
                  >
                    <AppOptionIcon appId={app.appId} appName={app.appName} />
                    <span class="open-with-dialog-option-content">
                      <span class="open-with-dialog-option-name">
                        {app.appName}
                      </span>
                      <span class="open-with-dialog-option-meta">
                        {app.isSuggested && (
                          <span class="eden-badge">
                            {t("files.suggestedApp")}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              }}
            </For>
          </div>
        )}

        <label class="eden-checkbox-option">
          <input
            type="checkbox"
            class="eden-checkbox"
            checked={ctx.value().setAsDefault}
            onChange={(event) =>
              ctx.setValue((current) => ({
                ...current,
                setAsDefault: event.currentTarget.checked,
              }))
            }
          />
          <span class="eden-checkbox-option-label">
            {t("files.setAsDefault")}
          </span>
        </label>
      </div>
    ),
    footer: (ctx) => (
      <>
        <button type="button" class="eden-btn" onClick={() => ctx.cancel()}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          ref={ctx.setPrimaryActionRef}
          class="eden-btn eden-btn-primary"
          disabled={!ctx.value().appId}
          onClick={() => {
            const appId = ctx.value().appId;
            if (!appId) {
              return;
            }

            ctx.submit({
              appId,
              setAsDefault: ctx.value().setAsDefault,
            });
          }}
        >
          {t("files.open")}
        </button>
      </>
    ),
  });
};
