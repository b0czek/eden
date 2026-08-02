import type { RuntimeAppManifest } from "@edenapp/types";
import { injectable, Lifecycle, scoped } from "tsyringe";

@scoped(Lifecycle.ContainerScoped)
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

  dispose(): void {
    this.manifests.clear();
  }
}
