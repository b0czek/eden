import { createAssociationsSdkController } from "../applications/app-associations/controller-sdk";
import type { AppAssociations } from "../applications/app-associations/service";
import { createDaemonsSdkController } from "../applications/daemon/controller-sdk";
import type { Daemons } from "../applications/daemon/service";
import { createPackagesSdkController } from "../applications/packages/controller-sdk";
import type { Packages } from "../applications/packages/service";
import { createUsersSdkController } from "../core/user/controller-sdk";
import type { Users } from "../core/user/service";
import { createAppearanceSdkController } from "../desktop/appearance/controller-sdk";
import type { Appearance } from "../desktop/appearance/service";
import { createSessionsSdkController } from "../desktop/session/controller-sdk";
import type { Sessions } from "../desktop/session/service";
import { createVolumesSdkController } from "../platform/filesystem/volumes/controller-sdk";
import type { Volumes } from "../platform/filesystem/volumes/service";
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
