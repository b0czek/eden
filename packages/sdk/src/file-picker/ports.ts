import type { AppAssociation, RuntimeAppManifest } from "@edenapp/types";

/** Resolve configured or fallback providers without exposing their storage. */
export interface FilePickerAssociations {
  resolve(
    key: string,
    matches: (app: RuntimeAppManifest) => boolean,
  ): AppAssociation[];
}
