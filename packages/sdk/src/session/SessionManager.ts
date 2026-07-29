import type { UserProfile } from "@edenapp/types";
import { inject, singleton } from "tsyringe";
import { CommandRegistry, EdenEmitter, EdenNamespace, IPCBridge } from "../ipc";
import { ProcessManager } from "../process-manager/ProcessManager";
import { UserManager } from "../user/UserManager";
import { SessionContext } from "./SessionContext";
import { SessionHandler } from "./SessionHandler";

interface SessionNamespaceEvents {
  changed: {
    currentUser: UserProfile | null;
    previousUsername: string | null;
    reason: "login" | "logout" | "system";
  };
}

@singleton()
@EdenNamespace("session")
export class SessionManager extends EdenEmitter<SessionNamespaceEvents> {
  private initialized = false;
  private transitionInProgress = false;

  constructor(
    @inject(IPCBridge) ipcBridge: IPCBridge,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject(UserManager) private userManager: UserManager,
    @inject(ProcessManager) private processManager: ProcessManager,
    @inject(SessionContext) private context: SessionContext,
  ) {
    super(ipcBridge);
    commandRegistry.registerManager(new SessionHandler(this));
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const defaultUser = await this.userManager.getDefaultUser();
    if (defaultUser) {
      await this.runTransition(() => this.transitionTo(defaultUser, "system"));
    }
    this.initialized = true;
  }

  getCurrentUser(): UserProfile | null {
    return this.context.getCurrentUser();
  }

  hasGrant(grant: string): boolean {
    return this.context.hasGrant(grant);
  }

  async login(username: string, password: string): Promise<UserProfile> {
    return await this.runTransition(async () => {
      const user = await this.userManager.authenticate(username, password);
      await this.transitionTo(user, "login");
      return user;
    });
  }

  async logout(): Promise<void> {
    await this.runTransition(() => this.transitionTo(null, "logout"));
  }

  synchronizeUser(user: UserProfile): void {
    const currentUser = this.context.getCurrentUser();
    if (currentUser?.username !== user.username) return;

    this.context.setCurrentUser(user);
    this.notify("changed", {
      currentUser: this.context.getCurrentUser(),
      previousUsername: user.username,
      reason: "system",
    });
  }

  private async transitionTo(
    user: UserProfile | null,
    reason: SessionNamespaceEvents["changed"]["reason"],
  ): Promise<void> {
    const previousUser = this.context.getCurrentUser();
    const previousUsername = previousUser?.username ?? null;
    const nextUsername = user?.username ?? null;

    if (previousUsername !== nextUsername) {
      await this.processManager.stopSessionApps();
    }

    this.context.setCurrentUser(user);
    this.notify("changed", {
      currentUser: this.context.getCurrentUser(),
      previousUsername,
      reason,
    });
  }

  private async runTransition<T>(task: () => Promise<T>): Promise<T> {
    if (this.transitionInProgress) {
      throw new Error("A session transition is already in progress");
    }

    this.transitionInProgress = true;
    try {
      return await task();
    } finally {
      this.transitionInProgress = false;
    }
  }
}
