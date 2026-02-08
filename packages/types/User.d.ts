export type UserRole = "standard" | "vendor";

export interface UserProfile {
  username: string;
  name: string;
  role: UserRole;
  grants: string[];
  createdAt: number;
  updatedAt: number;
}

export interface EdenUserConfig {
  username: string;
  name: string;
  role?: UserRole;
  password?: string;
  passwordHash?: string;
  passwordSalt?: string;
  grants?: string[];
}
