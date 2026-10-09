import type { FilesystemVolume } from "@edenapp/types";
import { createSignal } from "solid-js";

/** Own submissions independently of navigation while the OS releases a drive. */
export function useVolumeEject(options: {
  onRemoved: (volume: FilesystemVolume) => void;
  onError: (error: Error, volume: FilesystemVolume) => void;
}) {
  const [pending, setPending] = createSignal(new Set<string>());
  const eject = async (volume: FilesystemVolume) => {
    if (
      !volume.supportsEject ||
      volume.state !== "ready" ||
      pending().has(volume.id)
    )
      return;
    setPending((ids) => new Set([...ids, volume.id]));
    try {
      const removal = await window.edenAPI.shellCommand("volume/eject", {
        volume: volume.id,
      });
      await removal.result();
      options.onRemoved(volume);
    } catch (error) {
      options.onError(
        error instanceof Error ? error : new Error(String(error)),
        volume,
      );
    } finally {
      setPending((ids) => {
        const next = new Set(ids);
        next.delete(volume.id);
        return next;
      });
    }
  };
  return { eject, isPending: (volume: string) => pending().has(volume) };
}
