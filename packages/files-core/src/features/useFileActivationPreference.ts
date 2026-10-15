import * as eden from "@edenapp/client";
import { createSignal, onCleanup, onMount } from "solid-js";

export const FILES_APP_ID = "com.eden.files";
export const SINGLE_CLICK_SETTING_KEY = "openItemsWithSingleClick";

export const useFileActivationPreference = (ownerAppId?: string) => {
  const [openWithSingleClick, setOpenWithSingleClick] = createSignal(false);

  const applyValue = (value: string | undefined) => {
    setOpenWithSingleClick(value === "true");
  };

  const handleChanged = (data: {
    appId: string;
    key: string;
    value: string;
  }) => {
    if (
      data.appId === (ownerAppId ?? FILES_APP_ID) &&
      data.key === SINGLE_CLICK_SETTING_KEY
    ) {
      applyValue(data.value);
    }
  };

  onMount(async () => {
    try {
      await eden.settings.subscribe("changed", handleChanged);
      const result = await eden.settings.get(SINGLE_CLICK_SETTING_KEY, {
        ...(ownerAppId ? { appId: ownerAppId } : {}),
      });
      applyValue(result.value);
    } catch (error) {
      console.error("Failed to load file activation preference:", error);
    }
  });

  onCleanup(() => {
    void eden.settings.unsubscribe("changed", handleChanged);
  });

  return openWithSingleClick;
};
