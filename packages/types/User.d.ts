export type UserRole = "standard" | "vendor";

export interface UserProfile {
  username: string;
  name: string;
  role: UserRole;
  /** Writable filesystem root relative to EdenConfig.userDirectory. */
  homeDirectory?: string;
  grants: string[];
  createdAt: number;
  updatedAt: number;
}

export interface EdenUserConfig {
  username: string;
  name: string;
  role?: UserRole;
  /** Writable filesystem root relative to EdenConfig.userDirectory. */
  homeDirectory?: string;
  password?: string;
  passwordHash?: string;
  passwordSalt?: string;
  grants?: string[];
}
