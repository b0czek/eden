import type { AppAssociations } from "../app-associations";
import { createAssociationsSdkController } from "../app-associations/controller-sdk";
import { createAppearanceSdkController } from "../appearance/controller-sdk";
import type { Appearance } from "../appearance/service";
import type { DaemonManager } from "../daemon";
import { createDaemonsSdkController } from "../daemon/controller-sdk";
import { createVolumesSdkController } from "../filesystem/controller-sdk";
import type { VolumeManager } from "../filesystem/VolumeManager";
import type { PackageManager } from "../package-manager";
import { createPackagesSdkController } from "../package-manager/controller-sdk";
import type { SessionManager } from "../session";
import { createSessionsSdkController } from "../session/controller-sdk";
import type { UserManager } from "../user";
import { createUsersSdkController } from "../user/controller-sdk";
import type {
  EdenAppearanceApi,
  EdenAssociationsApi,
  EdenDaemonsApi,
  EdenPackagesApi,
  EdenSessionsApi,
  EdenUsersApi,
  EdenVolumesApi,
} from "./ControlPlaneApi";
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
  packageManager: PackageManager;
  daemonManager: DaemonManager;
  userManager: UserManager;
  sessionManager: SessionManager;
  appearance: Appearance;
  associationManager: AppAssociations;
  volumeManager: VolumeManager;
  sdk: SdkContext;
}

/** Compose the domain-owned SDK boundaries exposed by the host API. */
export function createControlPlaneApis({
  packageManager: packages,
  daemonManager: daemons,
  userManager: users,
  sessionManager: sessions,
  appearance,
  associationManager: associations,
  volumeManager: volumes,
  sdk,
}: Dependencies): EdenControlPlaneApis {
  return {
    packages: createPackagesSdkController({ packages, sdk }),
    daemons: createDaemonsSdkController({ daemons, sdk }),
    users: createUsersSdkController({ users, sessions, sdk }),
    sessions: createSessionsSdkController({ sessions, sdk }),
    appearance: createAppearanceSdkController({ appearance, sdk }),
    associations: createAssociationsSdkController({ associations, sdk }),
    volumes: createVolumesSdkController({ volumes, sdk }),
  };
}
