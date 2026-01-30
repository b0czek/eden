import { createSignal, onMount, Show, For } from "solid-js";
import { AppManifest } from "@edenapp/types";
import { FiPackage, FiAlertTriangle, FiCheck, FiLock } from "solid-icons/fi";

interface PackageInfoResponse {
  success: boolean;
  manifest?: AppManifest;
  error?: string;
}

const App = () => {
  const [loading, setLoading] = createSignal(true);
  const [installing, setInstalling] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [success, setSuccess] = createSignal(false);
  const [manifest, setManifest] = createSignal<AppManifest | null>(null);
  const [packagePath, setPackagePath] = createSignal<string | null>(null);

  onMount(async () => {
    const launchArgs = window.edenAPI.getLaunchArgs();
    if (launchArgs.length > 0) {
      loadPackage(launchArgs[0]);
    } else {
      setLoading(false);
      setError("No package file specified.");
    }

    window.edenAPI.subscribe("file/opened", (data: any) => {
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
      const result = await window.edenAPI.shellCommand("package/get-info", { path }) as any as PackageInfoResponse;
      
      if (result.success && result.manifest) {
        setManifest(result.manifest);
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
    if (!path) return;

    setInstalling(true);
    try {
      await window.edenAPI.shellCommand("package/install", { sourcePath: path });
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
    return name["en"] || Object.values(name)[0] || "Unknown App";
};

  return (
    <div class="eden-glass-medium installer-layout">
      <Show when={loading()}>
        <div class="eden-flex-center eden-text-secondary" style={{height: "100%"}}>
          <div class="eden-loading-spinner"></div>
          <p class="eden-mt-md">Loading package...</p>
        </div>
      </Show>

      <Show when={error()}>
        <div class="eden-flex-center eden-text-danger" style={{height: "100%", "flex-direction": "column"}}>
          <FiAlertTriangle size={48} />
          <h2 class="eden-mt-md">Error</h2>
          <p class="eden-text-secondary eden-mb-lg">{error()}</p>
          <button class="eden-btn eden-btn-secondary" onClick={() => loadPackage(packagePath()!)}>Retry</button>
        </div>
      </Show>

      <Show when={!loading() && !error() && manifest()} keyed>
        {(app) => (
          <>
            <div class={`installer-content ${success() ? 'eden-blur-sm' : ''}`}>
                <div class="app-header eden-flex-center" style="flex-direction: column;">
                    <div class="eden-card eden-flex-center" style="width: 96px; height: 96px; border-radius: 20px; font-size: 48px;">
                        <FiPackage />
                    </div>
                    <h1 class="eden-mt-md eden-mb-xs">{getLocalizedName(app.name)}</h1>
                    <div class="eden-text-secondary eden-text-sm eden-flex-center eden-gap-md">
                        <span class="eden-badge eden-badge-secondary">v{app.version}</span>
                        <span>by {app.author || "Unknown"}</span>
                    </div>
                    <p class="eden-text-secondary eden-mt-md eden-text-center">{app.description}</p>
                </div>

                <div class="permissions-section eden-card eden-p-lg eden-mt-xl">
                    <h3 class="eden-card-title eden-mb-md">Permissions</h3>
                    <Show when={app.permissions && app.permissions.length > 0} fallback={<p class="eden-text-secondary eden-text-sm">No special permissions required.</p>}>
                        <ul class="eden-list">
                            <For each={app.permissions}>
                                {(perm) => (
                                    <li class="eden-list-item">
                                        <FiLock class="eden-text-secondary eden-mr-sm" />
                                        <span>{perm}</span>
                                    </li>
                                )}
                            </For>
                        </ul>
                    </Show>
                </div>

                <Show when={app.backend}>
                    <div class="eden-card eden-card-outlined eden-border-danger eden-bg-danger-transparent eden-mt-lg eden-p-md">
                        <div class="eden-flex-start eden-gap-md">
                            <FiAlertTriangle class="eden-text-danger" size={24} />
                            <div>
                                <strong class="eden-text-danger">Full System Access</strong>
                                <p class="eden-text-danger eden-text-sm eden-mt-xs">This application includes a background service and has full access to the system.</p>
                            </div>
                        </div>
                    </div>
                </Show>

                <div class="eden-mt-auto eden-flex-end eden-gap-md eden-pt-lg">
                    <button class="eden-btn eden-btn-secondary" disabled={installing() || success()} onClick={closeWindow}>Cancel</button>
                    <button class="eden-btn eden-btn-primary" disabled={installing() || success()} onClick={installPackage}>
                        {installing() ? "Installing..." : "Install"}
                    </button>
                </div>
            </div>

            <Show when={success()}>
                <div class="success-overlay eden-flex-center">
                    <div class="eden-card eden-card-elevated eden-p-xl eden-flex-center" style="flex-direction: column;">
                        <div class="eden-badge-dot eden-badge-success" style="width: 64px; height: 64px; display: flex; align-items: center; justify-content: center; margin-bottom: 20px;">
                            <FiCheck size={32} />
                        </div>
                        <h2 class="eden-mb-sm">Installed Successfully!</h2>
                        <p class="eden-text-secondary">{getLocalizedName(app.name)} has been installed.</p>
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
