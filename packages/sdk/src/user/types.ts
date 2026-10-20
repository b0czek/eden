import type { UserProfile, UserRole } from "@edenapp/types";

export interface StoredUser extends UserProfile {
  passwordHash: string;
  passwordSalt: string;
}

export interface CreateUser {
  username?: string;
  name: string;
  role?: UserRole;
  password: string;
  grants?: string[];
  directoryRestriction?: string;
}

export interface UpdateUser {
  username: string;
  name?: string;
  role?: UserRole;
  grants?: string[];
  directoryRestriction?: string | null;
}
