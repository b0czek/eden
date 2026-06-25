export interface AppAssociation {
  appId: string;
  kind: string;
  label?: string;
}

export interface AppAssociationStore {
  version: 1;
  associations: Record<string, AppAssociation>;
}
