export type UserRole = "standard" | "vendor";

export interface UserProfile {
  username: string;
  name: string;
  role: UserRole;
  /** Optional accessible folder relative to the Home volume root. */
  directoryRestriction?: string;
  grants: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SessionChange {
  currentUser: UserProfile | null;
  previousUsername: string | null;
  reason: "login" | "logout" | "system";
}

export interface EdenUserConfig {
  username: string;
  name: string;
  role?: UserRole;
  /** Optional accessible folder relative to the Home volume root. */
  directoryRestriction?: string;
  password?: string;
  passwordHash?: string;
  passwordSalt?: string;
  grants?: string[];
}
