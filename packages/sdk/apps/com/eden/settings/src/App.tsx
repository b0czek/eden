import type {
  SettingsPanelActionResponse,
  SettingsPanelError,
  SettingsPanelResponse,
  SettingsPanelSummary,
  SettingsPanelValue,
} from "@edenapp/types";
import type { Component } from "solid-js";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import SettingsContent from "./components/SettingsContent";
import SettingsSidebar from "./components/SettingsSidebar";
import { initLocale } from "./i18n";
import type { LoadedPanel } from "./types";
import "./App.css";

const App: Component = () => {
  const [catalog, setCatalog] = createSignal<SettingsPanelSummary[]>([]);
  const [selectedPanelId, setSelectedPanelId] = createSignal<string | null>(
    null,
  );
  const [loadedPanel, setLoadedPanel] = createSignal<LoadedPanel | null>(null);
  const [loadingCatalog, setLoadingCatalog] = createSignal(true);
  const [loadingPanel, setLoadingPanel] = createSignal(false);
  const [panelError, setPanelError] = createSignal<SettingsPanelError | null>(
    null,
  );
  const [operationError, setOperationError] =
    createSignal<SettingsPanelError | null>(null);
  const [busyActions, setBusyActions] = createSignal<Set<string>>(new Set());
  const [brandName, setBrandName] = createSignal("Eden");
  let panelRequest = 0;

  const loadBranding = async () => {
    try {
      const branding = await window.edenAPI.shellCommand("system/branding", {});
      setBrandName(branding.name);
    } catch {
      // The product name fallback remains usable.
    }
  };

  const loadCatalog = async () => {
    try {
      const result = await window.edenAPI.shellCommand("settings/panels", {});
      const panels = Array.isArray(result.panels) ? result.panels : [];
      setCatalog(panels);
      const selected = selectedPanelId();
      if (selected && !panels.some((panel) => panel.id === selected)) {
        setSelectedPanelId(null);
        setLoadedPanel(null);
        setPanelError(null);
      }
    } catch {
      setCatalog([]);
      setSelectedPanelId(null);
      setLoadedPanel(null);
      setPanelError({
        code: "load_failed",
        message: "The settings catalog could not be loaded.",
      });
    } finally {
      setLoadingCatalog(false);
    }
  };

  const loadSelectedPanel = async (showLoading = true) => {
    const panelId = selectedPanelId();
    if (!panelId) {
      setLoadedPanel(null);
      return;
    }

    const request = ++panelRequest;
    if (showLoading) setLoadingPanel(true);
    setPanelError(null);
    try {
      const response: SettingsPanelResponse = await window.edenAPI.shellCommand(
        "settings/panel",
        { panelId },
      );
      if (request !== panelRequest || selectedPanelId() !== panelId) return;
      if (response.error || !response.panel || !response.state) {
        setLoadedPanel(null);
        setPanelError(
          response.error ?? {
            code: "load_failed",
            message: "The settings panel returned an incomplete response.",
          },
        );
        return;
      }
      const declaration = response.panel;
      const state = response.state;
      setLoadedPanel((current) => ({
        declaration:
          !showLoading && current?.declaration.id === declaration.id
            ? current.declaration
            : declaration,
        state,
      }));
    } catch {
      if (request !== panelRequest) return;
      setLoadedPanel(null);
      setPanelError({
        code: "load_failed",
        message: "The settings panel could not be loaded.",
      });
    } finally {
      if (showLoading && request === panelRequest) setLoadingPanel(false);
    }
  };

  const refresh = async () => {
    await loadCatalog();
    if (selectedPanelId()) await loadSelectedPanel();
  };

  onMount(async () => {
    await initLocale();
    await Promise.all([loadBranding(), loadCatalog()]);
    await window.edenAPI.subscribe("settings/panels-changed", refresh);
  });
  onCleanup(() => {
    void window.edenAPI.unsubscribe("settings/panels-changed", refresh);
  });

  createEffect(() => {
    selectedPanelId();
    void loadSelectedPanel();
  });

  const runAction = async (
    actionId: string,
    input?: SettingsPanelValue,
  ): Promise<SettingsPanelActionResponse> => {
    const panelId = selectedPanelId();
    if (!panelId) {
      return {
        success: false,
        error: {
          code: "not_found",
          message: "No settings panel is selected.",
        },
      };
    }

    setBusyActions((current) => new Set(current).add(actionId));
    setOperationError(null);
    let result: SettingsPanelActionResponse;
    try {
      result = await window.edenAPI.shellCommand("settings/action", {
        panelId,
        actionId,
        input,
      });
      if (result.error) setOperationError(result.error);
    } catch {
      result = {
        success: false,
        error: {
          code: "action_failed",
          message: "The settings operation failed.",
        },
      };
      setOperationError(result.error ?? null);
    } finally {
      // An action is never retried. State is always read again because the
      // operation may have completed before its response failed.
      await loadSelectedPanel(false);
      setBusyActions((current) => {
        const next = new Set(current);
        next.delete(actionId);
        return next;
      });
    }
    return result;
  };

  return (
    <div class="settings-app">
      <SettingsSidebar
        brandName={brandName}
        panels={catalog}
        selectedPanelId={selectedPanelId}
        onSelect={setSelectedPanelId}
      />
      <SettingsContent
        loading={() => loadingCatalog() || loadingPanel()}
        loadedPanel={loadedPanel}
        panelError={panelError}
        operationError={operationError}
        busyActions={busyActions}
        onAction={runAction}
        onRetry={loadSelectedPanel}
      />
    </div>
  );
};

export default App;
