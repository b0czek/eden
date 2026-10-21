import type { AppAssociations } from "../app-associations";
import { createAssociationsSdkController } from "../app-associations/controller-sdk";
import { createAppearanceSdkController } from "../appearance/controller-sdk";
import type { Appearance } from "../appearance/service";
import type { Daemons } from "../daemon";
import { createDaemonsSdkController } from "../daemon/controller-sdk";
import { createVolumesSdkController } from "../filesystem/volumes/controller-sdk";
import type { Volumes } from "../filesystem/volumes/service";
import type { Packages } from "../packages";
import { createPackagesSdkController } from "../packages/controller-sdk";
import type { Sessions } from "../session";
import { createSessionsSdkController } from "../session/controller-sdk";
import type { Users } from "../user";
import { createUsersSdkController } from "../user/controller-sdk";
import type {
  EdenAppearanceApi,
  EdenAssociationsApi,
  EdenDaemonsApi,
  EdenPackagesApi,
  EdenSessionsApi,
  EdenUsersApi,
  EdenVolumesApi,
} from "./control-plane";
import type { SdkContext } from "./sdk-context";

export interface EdenControlPlaneApis {
  packages: EdenPackagesApi;
  daemons: EdenDaemonsApi;
  users: EdenUsersApi;
  sessions: EdenSessionsApi;
  appearance: EdenAppearanceApi;
  associations: EdenAssociationsApi;
  volumes: EdenVolumesApi;
}

interface Dependencies {
  packages: Packages;
  daemons: Daemons;
  users: Users;
  sessions: Sessions;
  appearance: Appearance;
  associations: AppAssociations;
  volumes: Volumes;
  sdk: SdkContext;
}

/** Compose the domain-owned SDK boundaries exposed by the host API. */
export function createControlPlaneApis({
  packages,
  daemons,
  users,
  sessions,
  appearance,
  associations,
  volumes,
  sdk,
}: Dependencies): EdenControlPlaneApis {
  return {
    packages: createPackagesSdkController({ packages, sdk }),
    daemons: createDaemonsSdkController({ daemons, sdk }),
    users: createUsersSdkController({ users, sdk }),
    sessions: createSessionsSdkController({ sessions, sdk }),
    appearance: createAppearanceSdkController({ appearance, sdk }),
    associations: createAssociationsSdkController({ associations, sdk }),
    volumes: createVolumesSdkController({ volumes, sdk }),
  };
}
