import type { UserProfile } from "@edenapp/types";

export interface StoredUser extends UserProfile {
  passwordHash: string;
  passwordSalt: string;
}
