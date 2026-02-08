/**
 * Hello World Frontend
 */

import type { PeerConnection } from "@edenapp/types/ipc";
import type { HelloProtocol } from "../../shared/protocol";

class HelloApp {
  private statusDiv: HTMLElement | null;

  constructor() {
    this.statusDiv = document.getElementById("status");
    this.setupEventListeners();
    this.setupMessageListeners();
    this.log("App initialized");
  }

  private getAppAPI(): PeerConnection<HelloProtocol> {
    return window.getAppAPI() as PeerConnection<HelloProtocol>;
  }

  private setupEventListeners(): void {
    document.getElementById("ping-btn")?.addEventListener("click", () => {
      this.pingBackend();
    });

    document.getElementById("status-btn")?.addEventListener("click", () => {
      this.getBackendStatus();
    });

    document.getElementById("hello-btn")?.addEventListener("click", () => {
      this.sayHello();
    });
  }

  private setupMessageListeners(): void {
    const appAPI = this.getAppAPI();

    // Listen for messages from backend - fully typed!
    appAPI.on("backend-ready", (payload) => {
      // payload.message is typed as string
      this.log(`✓ ${payload.message}`);
    });

    appAPI.on("heartbeat", (payload) => {
      // payload is typed as { timestamp: number; messageCount: number }
      console.log("Heartbeat from backend:", payload);
    });
  }

  private async pingBackend(): Promise<void> {
    this.log("Sending ping to backend...");

    try {
      // response is typed as { timestamp: number; messageCount: number }
      const response = await this.getAppAPI().request("ping", {});
      this.log(`Pong received! Message count: ${response.messageCount}`);
    } catch (error) {
      this.log(`Error: ${(error as Error).message}`);
    }
  }

  private async getBackendStatus(): Promise<void> {
    this.log("Requesting backend status...");

    try {
      // response is typed as { status: string; uptime: number; messageCount: number }
      const response = await this.getAppAPI().request("get-status", {});
      this.log(`Status: ${response.status}`);
      this.log(`Uptime: ${response.uptime.toFixed(2)}s`);
      this.log(`Messages: ${response.messageCount}`);
    } catch (error) {
      this.log(`Error: ${(error as Error).message}`);
    }
  }

  private async sayHello(): Promise<void> {
    const userMessage = await this.showInputDialog(
      "Say Hello",
      "What would you like to say?",
      "Hello from frontend!",
    );
    if (!userMessage) return;

    this.log(`Sending: "${userMessage}"`);

    try {
      // request arg is typed as { message: string }
      // response is typed as { message: string }
      const response = await this.getAppAPI().request("hello", {
        message: userMessage,
      });
      this.log(`Backend says: ${response.message}`);
    } catch (error) {
      this.log(`Error: ${(error as Error).message}`);
    }
  }

  private showInputDialog(
    title: string,
    placeholder = "Enter value...",
    defaultValue = "",
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const overlay = document.getElementById("input-dialog");
      const titleEl = document.getElementById("input-dialog-title");
      const input = document.getElementById(
        "input-dialog-input",
      ) as HTMLInputElement | null;
      const closeBtn = document.getElementById("input-dialog-close");
      const cancelBtn = document.getElementById("input-dialog-cancel");
      const confirmBtn = document.getElementById("input-dialog-confirm");

      if (
        !overlay ||
        !titleEl ||
        !input ||
        !closeBtn ||
        !cancelBtn ||
        !confirmBtn
      ) {
        resolve(null);
        return;
      }

      titleEl.textContent = title;
      input.placeholder = placeholder;
      input.value = defaultValue;
      overlay.style.display = "flex";

      setTimeout(() => input.focus(), 100);

      const cleanup = (result: string | null) => {
        overlay.style.display = "none";
        input.value = "";
        resolve(result);
      };

      const handleConfirm = () => {
        const value = input.value.trim();
        cleanup(value || null);
      };

      const handleCancel = () => {
        cleanup(null);
      };

      confirmBtn.onclick = handleConfirm;
      cancelBtn.onclick = handleCancel;
      closeBtn.onclick = handleCancel;

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Enter") {
          handleConfirm();
          input.removeEventListener("keydown", handleKeyDown);
        } else if (e.key === "Escape") {
          handleCancel();
          input.removeEventListener("keydown", handleKeyDown);
        }
      };
      input.addEventListener("keydown", handleKeyDown);

      overlay.onclick = (e) => {
        if (e.target === overlay) {
          handleCancel();
        }
      };
    });
  }

  private log(text: string): void {
    const p = document.createElement("p");
    p.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;

    if (this.statusDiv) {
      this.statusDiv.appendChild(p);
      this.statusDiv.scrollTop = this.statusDiv.scrollHeight;

      while (this.statusDiv.children.length > 20) {
        this.statusDiv.removeChild(this.statusDiv.firstChild!);
      }
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => new HelloApp());
} else {
  new HelloApp();
}
