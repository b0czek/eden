import type {
  AppManifest,
  PackageManifest,
  PackageOperationPreview,
} from "@edenapp/types";
import { FiAlertTriangle, FiCheck, FiLock, FiPackage } from "solid-icons/fi";
import { createSignal, For, onMount, Show } from "solid-js";

interface PackageInfoResponse {
  success: boolean;
  manifest?: PackageManifest;
  preview?: PackageOperationPreview;
  error?: string;
}

const App = () => {
  const [loading, setLoading] = createSignal(true);
  const [installing, setInstalling] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [success, setSuccess] = createSignal(false);
  const [manifest, setManifest] = createSignal<PackageManifest | null>(null);
  const [preview, setPreview] = createSignal<PackageOperationPreview | null>(
    null,
  );
  const [packagePath, setPackagePath] = createSignal<string | null>(null);

  onMount(async () => {
    const launchArgs = window.edenAPI.getLaunchArgs();
    if (launchArgs.length > 0) {
      loadPackage(launchArgs[0]);
    } else {
      setLoading(false);
      setError("No package file specified.");
    }

    window.edenAPI.subscribe("file/opened", (data) => {
      if (data.path) {
        loadPackage(data.path);
      }
    });
  });

  const loadPackage = async (path: string) => {
    setLoading(true);
    setError(null);
    setPackagePath(path);
    setSuccess(false);

    try {
      const result: PackageInfoResponse = await window.edenAPI.shellCommand(
        "package/get-info",
        {
          path,
        },
      );

      if (result.success && result.manifest) {
        setManifest(result.manifest);
        setPreview(result.preview ?? null);
      } else {
        setError(result.error || "Failed to load package info.");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const installPackage = async () => {
    const path = packagePath();
    const packageManifest = manifest();
    if (!path || !packageManifest) return;

    const currentPreview = preview();
    const existingVersion = currentPreview?.existingVersion;
    if (existingVersion) {
      const removals =
        currentPreview?.kind === "app" ? currentPreview.incompatibleDlcs : [];
      const detail = removals.length
        ? `\n\nThe following incompatible DLCs will be removed:\n${removals
            .map((dlc) => `• ${getLocalizedName(dlc.name)}`)
            .join("\n")}`
        : "";
      if (
        !confirm(
          `Confirm ${replacementLabel(existingVersion, packageManifest.version).toLowerCase()} of ${getLocalizedName(packageManifest.name)}.${detail}`,
        )
      ) {
        return;
      }
    }

    setInstalling(true);
    try {
      await window.edenAPI.shellCommand("package/install", {
        sourcePath: path,
        replace: !!existingVersion,
      });
      setSuccess(true);
      setTimeout(() => {
        // window.close();
      }, 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setInstalling(false);
    }
  };

  const closeWindow = () => {
    // Implement close logic
  };

  const getLocalizedName = (name: AppManifest["name"]): string => {
    if (typeof name === "string") return name;
    return name.en || Object.values(name)[0] || "Unknown App";
  };

  const replacementLabel = (from: string, to: string): string => {
    if (from === to) return "Reinstall";
    return to.localeCompare(from, undefined, { numeric: true }) > 0
      ? "Upgrade"
      : "Downgrade";
  };

  const blockingMessage = () => {
    const current = preview();
    if (!current) return null;
    if (current.hostRunning) return "The host app must be stopped first.";
    if (current.replaceable === false) {
      return "Prebuilt and development apps cannot be replaced.";
    }
    return current.kind === "dlc"
      ? current.compatibilityErrors.join(" ") || null
      : null;
  };

  const installLabel = (version: string): string => {
    const existingVersion = preview()?.existingVersion;
    return existingVersion
      ? replacementLabel(existingVersion, version)
      : "Install";
  };

  const previewHostName = () => {
    const current = preview();
    return current?.kind === "dlc" ? current.host?.name : undefined;
  };

  return (
    <div class="eden-glass-medium installer-layout">
      <Show when={loading()}>
        <div
          class="eden-flex-center eden-text-secondary"
          style={{ height: "100%" }}
        >
          <div class="eden-loading-spinner"></div>
          <p class="eden-mt-md">Loading package...</p>
        </div>
      </Show>

      <Show when={error()}>
        <div
          class="eden-flex-center eden-text-danger"
          style={{ height: "100%", "flex-direction": "column" }}
        >
          <FiAlertTriangle size={48} />
          <h2 class="eden-mt-md">Error</h2>
          <p class="eden-text-secondary eden-mb-lg">{error()}</p>
          <button
            type="button"
            class="eden-btn eden-btn-secondary"
            onClick={() => {
              const path = packagePath();
              if (path) loadPackage(path);
            }}
          >
            Retry
          </button>
        </div>
      </Show>

      <Show when={!loading() && !error() && manifest()} keyed>
        {(app) => (
          <>
            <div class={`installer-content ${success() ? "eden-blur-sm" : ""}`}>
              <div
                class="app-header eden-flex-center"
                style="flex-direction: column;"
              >
                <div
                  class="eden-card eden-flex-center"
                  style="width: 96px; height: 96px; border-radius: 20px; font-size: 48px;"
                >
                  <FiPackage />
                </div>
                <h1 class="eden-mt-md eden-mb-xs">
                  {getLocalizedName(app.name)}
                </h1>
                <div class="eden-text-secondary eden-text-sm eden-flex-center eden-gap-md">
                  <span class="eden-badge eden-badge-secondary">
                    v{app.version}
                  </span>
                  <span class="eden-badge eden-badge-primary">
                    {app.kind === "dlc" ? "DLC" : "App"}
                  </span>
                  <span>by {app.author || "Unknown"}</span>
                </div>
                <p class="eden-text-secondary eden-mt-md eden-text-center">
                  {app.description}
                </p>
              </div>

              <Show
                when={app.kind === "dlc" ? app : null}
                fallback={
                  <div class="permissions-section eden-card eden-p-lg eden-mt-xl">
                    <h3 class="eden-card-title eden-mb-md">Permissions</h3>
                    <Show
                      when={app.kind !== "dlc" && app.permissions?.length}
                      fallback={
                        <p class="eden-text-secondary eden-text-sm">
                          No special permissions required.
                        </p>
                      }
                    >
                      <ul class="eden-list">
                        <For each={app.kind !== "dlc" ? app.permissions : []}>
                          {(permission) => (
                            <li class="eden-list-item">
                              <FiLock class="eden-text-secondary eden-mr-sm" />
                              <span>{permission}</span>
                            </li>
                          )}
                        </For>
                      </ul>
                    </Show>
                  </div>
                }
              >
                {(dlc) => (
                  <div class="eden-card eden-p-lg eden-mt-xl eden-flex-col eden-gap-md">
                    <div>
                      <strong>Host:</strong>{" "}
                      {getLocalizedName(previewHostName() ?? dlc().hostAppId)}
                    </div>
                    <h3 class="eden-card-title">Contributions</h3>
                    <For each={dlc().contributions}>
                      {(contribution) => (
                        <div class="eden-tag">
                          {contribution.extensionPoint} ·{" "}
                          {contribution.requires}
                        </div>
                      )}
                    </For>
                  </div>
                )}
              </Show>

              <Show when={blockingMessage()}>
                {(message) => (
                  <div class="eden-card eden-border-danger eden-bg-danger-transparent eden-mt-lg eden-p-md eden-text-danger">
                    <FiAlertTriangle /> {message()}
                  </div>
                )}
              </Show>

              <Show when={app.kind !== "dlc" && app.backend}>
                <div class="eden-card eden-card-outlined eden-border-danger eden-bg-danger-transparent eden-mt-lg eden-p-md">
                  <div class="eden-flex-start eden-gap-md">
                    <FiAlertTriangle class="eden-text-danger" size={24} />
                    <div>
                      <strong class="eden-text-danger">
                        Full System Access
                      </strong>
                      <p class="eden-text-danger eden-text-sm eden-mt-xs">
                        This application includes a background service and has
                        full access to the system.
                      </p>
                    </div>
                  </div>
                </div>
              </Show>

              <div class="eden-mt-auto eden-flex-end eden-gap-md eden-pt-lg">
                <button
                  type="button"
                  class="eden-btn eden-btn-secondary"
                  disabled={installing() || success()}
                  onClick={closeWindow}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="eden-btn eden-btn-primary"
                  disabled={installing() || success() || !!blockingMessage()}
                  onClick={installPackage}
                >
                  {installing() ? "Installing..." : installLabel(app.version)}
                </button>
              </div>
            </div>

            <Show when={success()}>
              <div class="success-overlay eden-flex-center">
                <div
                  class="eden-card eden-card-elevated eden-p-xl eden-flex-center"
                  style="flex-direction: column;"
                >
                  <div
                    class="eden-badge-dot eden-badge-success"
                    style="width: 64px; height: 64px; display: flex; align-items: center; justify-content: center; margin-bottom: 20px;"
                  >
                    <FiCheck size={32} />
                  </div>
                  <h2 class="eden-mb-sm">Installed Successfully!</h2>
                  <p class="eden-text-secondary">
                    {getLocalizedName(app.name)} has been installed.
                  </p>
                </div>
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
};

export default App;
