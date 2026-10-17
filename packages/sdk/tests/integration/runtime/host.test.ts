import { createEdenHost } from "../../../src/host";
import { gate } from "../../support/async";
import { createTestEden } from "../../support/createTestEden";

it("disposes the host before application readiness without starting desktop services", async () => {
  const eden = await createTestEden({ autoStart: false });
  const ready = gate<void>();
  eden.platform.application.whenReady = () => ready.promise;
  const host = createEdenHost({
    runtime: eden.runtime,
    application: eden.platform.application,
  });
  const readiness = expect(host.whenReady()).rejects.toThrow(
    "disposed before startup",
  );
  try {
    await host.dispose();
    await readiness;
    ready.release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(host.state).toBe("stopped");
    expect(eden.platform.activeResourceCount).toBe(0);
    expect(
      eden.platform.effects.some((effect) => effect.type === "window-created"),
    ).toBe(false);
    await host.dispose();
  } finally {
    ready.release();
    await eden.dispose();
  }
});
