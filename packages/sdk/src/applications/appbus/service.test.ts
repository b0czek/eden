import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import {
  buildService,
  createEffectRuntime,
} from "../../../tests/support/effect-runtime";
import { Backends } from "../processes/backends";
import { AppChannelFailure, AppServiceAlreadyRegistered } from "./errors";
import { AppChannelTransport } from "./ports";
import { AppChannels, AppChannelsLive } from "./service";

function dependency<T>(methods: Partial<T>): T {
  return new Proxy(methods as T & object, {
    get(target, key, receiver) {
      if (!(key in target))
        throw new Error(`Unexpected dependency access: ${String(key)}`);
      return Reflect.get(target, key, receiver);
    },
  });
}

async function fixture(
  createMessageChannel: AppChannelTransport["createMessageChannel"],
  hasBackend = () => true,
) {
  const runtime = createEffectRuntime(TestClock.layer());
  const channels = await runtime.acquire(
    buildService(
      AppChannels,
      AppChannelsLive.pipe(
        Layer.provide(
          Layer.succeed(AppChannelTransport, {
            createMessageChannel,
            getWebContentsById: () => undefined,
          }),
        ),
        Layer.provide(
          Layer.succeed(
            Backends,
            dependency<Backends>({
              hasBackend,
              sendMessage: () => true,
            }),
          ),
        ),
      ),
    ),
  );
  return { runtime, channels };
}

describe("AppBus connections and failures", () => {
  it("assigns distinct IDs to repeated connections without advancing the clock", async () => {
    const { runtime, channels } = await fixture(() => ({
      port1: { close() {} },
      port2: { close() {} },
    }));
    try {
      await runtime.run(channels.registerService("provider", "documents", 0));
      const first = await runtime.run(
        channels.connect("client", 0, "provider", "documents"),
      );
      const second = await runtime.run(
        channels.connect("client", 0, "provider", "documents"),
      );
      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      expect(first.connectionId).toEqual(expect.any(String));
      expect(second.connectionId).toEqual(expect.any(String));
      expect(second.connectionId).not.toBe(first.connectionId);
    } finally {
      await runtime.dispose();
    }
  });

  it("rejects duplicate registration without replacing the original service", async () => {
    const { runtime, channels } = await fixture(() => ({
      port1: { close() {} },
      port2: { close() {} },
    }));
    try {
      await runtime.run(
        channels.registerService("provider", "documents", 0, {
          description: "Original",
        }),
      );
      const error = await runtime.run(
        Effect.flip(
          channels.registerService("provider", "documents", 0, {
            description: "Replacement",
          }),
        ),
      );
      expect(error).toBeInstanceOf(AppServiceAlreadyRegistered);
      expect(error).toMatchObject({
        appId: "provider",
        serviceName: "documents",
      });
      expect(channels.listServices()).toEqual([
        {
          appId: "provider",
          serviceName: "documents",
          description: "Original",
        },
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("preserves native channel creation causes while ordinary refusals remain results", async () => {
    const cause = new Error("native channel allocation failed");
    const { runtime, channels } = await fixture(() => {
      throw cause;
    });
    try {
      await expect(
        runtime.run(channels.connect("client", 0, "provider", "missing")),
      ).resolves.toEqual({
        success: false,
        error: 'Service "missing" not found on app "provider"',
      });
      await runtime.run(channels.registerService("provider", "documents", 0));
      const error = await runtime.run(
        Effect.flip(channels.connect("client", 0, "provider", "documents")),
      );
      expect(error).toBeInstanceOf(AppChannelFailure);
      expect(error).toMatchObject({
        operation: "create-channel",
        requesterAppId: "client",
        targetAppId: "provider",
        serviceName: "documents",
      });
      expect(error.cause).toBe(cause);
    } finally {
      await runtime.dispose();
    }
  });
  it("keeps unexpected domain collaborator defects out of the recoverable failure channel", async () => {
    const defect = new TypeError("invalid backend registry state");
    const { runtime, channels } = await fixture(
      () => ({ port1: { close() {} }, port2: { close() {} } }),
      () => {
        throw defect;
      },
    );
    try {
      await runtime.run(channels.registerService("provider", "documents", 0));
      const exit = await runtime.run(
        Effect.exit(channels.connect("client", 0, "provider", "documents")),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (!Exit.isFailure(exit)) throw new Error("Expected a defective exit");
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(exit.cause.reasons).toContainEqual(
        expect.objectContaining({ _tag: "Die", defect }),
      );
    } finally {
      await runtime.dispose();
    }
  });
});
