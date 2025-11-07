// Eve Shell Renderer Process

interface AppManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
}

interface SystemInfo {
  runningApps: string[];
  installedApps: AppManifest[];
}

class EveShell {
  private installedApps: AppManifest[] = [];
  private runningApps: Set<string> = new Set();

  constructor() {
    this.init();
  }

  async init(): Promise<void> {
    // Setup event listeners
    this.setupEventListeners();

    // Listen for system messages
    window.edenAPI.onSystemMessage((message) => {
      this.handleSystemMessage(message);
    });

    // Load initial data
    await this.loadSystemInfo();
    this.updateUI();

    console.log("Eve shell initialized");
  }

  setupEventListeners(): void {
    // Install app button
    document
      .getElementById("install-app-btn")
      ?.addEventListener("click", () => {
        this.installApp();
      });

    // Refresh button
    document.getElementById("refresh-btn")?.addEventListener("click", () => {
      this.loadSystemInfo();
    });

    // Watch for workspace resize
    const workspace = document.getElementById("workspace");
    if (workspace) {
      const resizeObserver = new ResizeObserver(() => {
        this.updateRunningAppBounds();
      });
      resizeObserver.observe(workspace);
    }

    // Also handle window resize as a fallback
    window.addEventListener("resize", () => {
      this.updateRunningAppBounds();
    });
  }

  async updateRunningAppBounds(): Promise<void> {
    const workspace = document.getElementById("workspace");
    if (!workspace || this.runningApps.size === 0) return;

    const rect = workspace.getBoundingClientRect();
    const bounds = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };

    // Update bounds for all running apps
    for (const appId of this.runningApps) {
      try {
        await window.edenAPI.shellCommand("update-view-bounds", {
          appId,
          bounds,
        });
      } catch (error) {
        console.error(`Failed to update bounds for ${appId}:`, error);
      }
    }
  }

  async loadSystemInfo(): Promise<void> {
    try {
      const info = await window.edenAPI.getSystemInfo();
      console.log("System info:", info);

      this.runningApps = new Set(info.runningApps || []);

      // Get list of installed apps
      const appsData = await window.edenAPI.shellCommand("list-apps", {});
      console.log("Apps data:", appsData);

      if (appsData.installed) {
        this.installedApps = appsData.installed;
      }
      if (appsData.running) {
        this.runningApps = new Set(
          appsData.running.map((app: any) => app.appId)
        );
      }

      this.updateUI();
    } catch (error) {
      console.error("Failed to load system info:", error);
      this.setStatus("Error loading system info", "error");
    }
  }

  async installApp(): Promise<void> {
    try {
      // Use native file picker dialog for .edenite files
      const edenitePath = await window.edenAPI.selectDirectory();
      if (!edenitePath) return;

      this.setStatus("Installing app from .edenite package...", "info");
      await window.edenAPI.installApp(edenitePath);
      this.setStatus("App installed successfully! 🌱", "success");

      await this.loadSystemInfo();
    } catch (error: any) {
      console.error("Failed to install app:", error);
      this.setStatus(`Installation failed: ${error.message}`, "error");
    }
  }

  async launchApp(appId: string): Promise<void> {
    try {
      this.setStatus(`Launching ${appId}...`, "info");

      // Calculate bounds for the app view (full workspace area)
      const workspace = document.getElementById("workspace");
      if (!workspace) return;

      // Get the workspace position relative to the window
      const rect = workspace.getBoundingClientRect();

      const bounds = {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };

      console.log("Launching app with bounds:", bounds);

      await window.edenAPI.launchApp(appId, bounds);
      this.runningApps.add(appId);
      this.updateUI();
      this.setStatus(`${appId} is running`, "success");
    } catch (error: any) {
      console.error("Failed to launch app:", error);
      this.setStatus(`Launch failed: ${error.message}`, "error");
    }
  }

  async stopApp(appId: string): Promise<void> {
    try {
      this.setStatus(`Stopping ${appId}...`, "info");
      await window.edenAPI.stopApp(appId);
      this.runningApps.delete(appId);
      this.updateUI();
      this.setStatus("App stopped", "success");
    } catch (error: any) {
      console.error("Failed to stop app:", error);
      this.setStatus(`Stop failed: ${error.message}`, "error");
    }
  }

  async uninstallApp(appId: string): Promise<void> {
    try {
      this.setStatus(`Uninstalling ${appId}...`, "info");
      await window.edenAPI.uninstallApp(appId);
      this.setStatus("App uninstalled successfully", "success");
      await this.loadSystemInfo();
    } catch (error: any) {
      console.error("Failed to uninstall app:", error);
      this.setStatus(`Uninstall failed: ${error.message}`, "error");
    }
  }

  handleSystemMessage(message: any): void {
    console.log("System message:", message);

    switch (message.type) {
      case "app-launched":
        this.runningApps.add(message.payload.appId);
        this.updateUI();
        break;
      case "app-stopped":
        this.runningApps.delete(message.payload.appId);
        this.updateUI();
        break;
      case "app-installed":
        this.loadSystemInfo();
        break;
      case "app-uninstalled":
        this.loadSystemInfo();
        break;
    }
  }

  updateUI(): void {
    this.updateAppList();
    this.updateRunningAppsCount();
    this.updateWorkspace();
  }

  updateAppList(): void {
    const appList = document.getElementById("app-list");
    if (!appList) return;

    if (this.installedApps.length === 0) {
      appList.innerHTML =
        '<li class="app-item" style="color: #666;">No apps installed</li>';
      return;
    }

    appList.innerHTML = this.installedApps
      .map((app) => {
        const isRunning = this.runningApps.has(app.id);
        return `
          <li class="app-item ${isRunning ? "running" : ""}" data-app-id="${
          app.id
        }">
            ${app.name}
          </li>
        `;
      })
      .join("");

    // Add click handlers
    appList.querySelectorAll(".app-item[data-app-id]").forEach((item) => {
      // Left click - launch/stop
      item.addEventListener("click", () => {
        const appId = item.getAttribute("data-app-id");
        if (!appId) return;

        const isRunning = this.runningApps.has(appId);
        if (isRunning) {
          if (confirm(`Stop ${appId}?`)) {
            this.stopApp(appId);
          }
        } else {
          this.launchApp(appId);
        }
      });

      // Right click - uninstall
      item.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const appId = item.getAttribute("data-app-id");
        if (!appId) return;

        const app = this.installedApps.find((a) => a.id === appId);
        if (!app) return;

        const isRunning = this.runningApps.has(appId);
        if (isRunning) {
          alert("Cannot uninstall a running app. Please stop it first.");
          return;
        }

        if (confirm(`Uninstall "${app.name}"? This cannot be undone.`)) {
          this.uninstallApp(appId);
        }
      });
    });
  }

  updateRunningAppsCount(): void {
    const countElement = document.getElementById("running-apps-count");
    if (countElement) {
      const count = this.runningApps.size;
      countElement.textContent = `${count} app${
        count !== 1 ? "s" : ""
      } running`;
    }
  }

  updateWorkspace(): void {
    const emptyState = document.getElementById("empty-state");
    if (emptyState) {
      emptyState.style.display = this.runningApps.size > 0 ? "none" : "flex";
    }
  }

  setStatus(text: string, type: "info" | "success" | "error" = "info"): void {
    const statusElement = document.getElementById("status-text");
    if (statusElement) {
      statusElement.textContent = text;

      // Color based on type
      const colors = {
        info: "#888",
        success: "#4a9eff",
        error: "#ff6b6b",
      };
      statusElement.style.color = colors[type];

      // Reset to default after 3 seconds
      if (type !== "info") {
        setTimeout(() => {
          statusElement.textContent = "Ready";
          statusElement.style.color = "#888";
        }, 3000);
      }
    }
  }
}

// Initialize the shell when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => new EveShell());
} else {
  new EveShell();
}
