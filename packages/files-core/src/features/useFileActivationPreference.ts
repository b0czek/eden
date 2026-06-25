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
      await window.edenAPI.subscribe("settings/changed", handleChanged);
      const result = await window.edenAPI.shellCommand("settings/get", {
        key: SINGLE_CLICK_SETTING_KEY,
        ...(ownerAppId ? { appId: ownerAppId } : {}),
      });
      applyValue(result.value);
    } catch (error) {
      console.error("Failed to load file activation preference:", error);
    }
  });

  onCleanup(() => {
    void window.edenAPI.unsubscribe("settings/changed", handleChanged);
  });

  return openWithSingleClick;
};
