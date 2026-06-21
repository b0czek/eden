import type { EdenFrame } from "@edenapp/types";

export interface WaitForEdenFrameOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

const getEdenFrame = (): EdenFrame | undefined => {
  if (typeof window === "undefined") {
    throw new Error(
      "waitForEdenFrame can only be used in a browser environment.",
    );
  }

  return window.edenFrame;
};

export const waitForEdenFrame = (
  options: WaitForEdenFrameOptions = {},
): Promise<EdenFrame> => {
  const existing = getEdenFrame();
  if (existing) return Promise.resolve(existing);

  const timeoutMs = options.timeoutMs ?? 5000;
  const intervalMs = options.intervalMs ?? 50;
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const intervalId = window.setInterval(() => {
      const frame = getEdenFrame();
      if (frame) {
        window.clearInterval(intervalId);
        resolve(frame);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(intervalId);
        reject(new Error("Timed out waiting for edenFrame."));
      }
    }, intervalMs);
  });
};
