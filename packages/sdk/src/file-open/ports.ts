import type { AppAssociation } from "@edenapp/types";

/** Association capabilities needed to select and persist file handlers. */
export interface FileOpenAssociations {
  get(key: string): AppAssociation | undefined;
  list(options?: { kindPrefix?: string }): Record<string, AppAssociation>;
  set(key: string, association: AppAssociation): Promise<void>;
  remove(key: string): Promise<void>;
}
