import type { RuntimeAppManifest } from "@edenapp/types";
import { injectable, singleton } from "tsyringe";

@singleton()
@injectable()
export class AppRegistry {
  private manifests = new Map<string, RuntimeAppManifest>();

  register(manifest: RuntimeAppManifest): void {
    this.manifests.set(manifest.id, manifest);
  }

  unregister(appId: string): boolean {
    return this.manifests.delete(appId);
  }

  get(appId: string): RuntimeAppManifest | undefined {
    return this.manifests.get(appId);
  }

  has(appId: string): boolean {
    return this.manifests.has(appId);
  }

  list(): RuntimeAppManifest[] {
    return Array.from(this.manifests.values());
  }
}
