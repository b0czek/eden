export type UserRole = "standard" | "vendor";

export interface UserProfile {
  username: string;
  name: string;
  role: UserRole;
  /** Optional accessible folder relative to EdenConfig.userDirectory. */
  directoryRestriction?: string;
  grants: string[];
  createdAt: number;
  updatedAt: number;
}

export interface EdenUserConfig {
  username: string;
  name: string;
  role?: UserRole;
  /** Optional accessible folder relative to EdenConfig.userDirectory. */
  directoryRestriction?: string;
  password?: string;
  passwordHash?: string;
  passwordSalt?: string;
  grants?: string[];
}
