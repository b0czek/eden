import type { CommandArgs, CommandName } from "@edenapp/types";
import { expect } from "@playwright/test";
import type { ElectronHost } from "./host";

interface CommandPause {
  pending: boolean;
  completed: boolean;
  release(): void;
}

type PauseGlobal = typeof globalThis & {
  __edenCommandPause?: CommandPause;
};

/** Delay one matching request, then execute its real handler and return its result. */
export async function pauseCommand<C extends CommandName>(
  host: ElectronHost,
  command: C,
  match: { appId: string; args: Partial<CommandArgs<C>> },
) {
  const app = host.electronApp;
  if (!app) throw new Error("Electron app is not running");
  await app.evaluate(
    (_electron, target) => {
      const Effect = process
        .getBuiltinModule("node:module")
        .createRequire(`${process.cwd()}/package.json`)(
        "effect/Effect",
      ) as typeof import("effect/Effect");
      const { isDeepStrictEqual } = process.getBuiltinModule("node:util");
      const integration = globalThis as PauseGlobal & {
        __edenIntegration: {
          runtime: {
            services: {
              commands: {
                execute(
                  command: string,
                  args: Record<string, unknown>,
                  caller?: { appId?: string },
                  submission?: unknown,
                ): import("effect/Effect").Effect<unknown, unknown>;
              };
            };
          };
        };
      };
      if (integration.__edenCommandPause)
        throw new Error("A command pause is already installed");
      const registry = integration.__edenIntegration.runtime.services.commands;
      const execute = registry.execute;
      let resume!: () => void;
      const resumed = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const state: CommandPause = {
        pending: false,
        completed: false,
        release: () => {
          registry.execute = execute;
          resume();
        },
      };
      integration.__edenCommandPause = state;
      registry.execute = (command, args, caller, submission) =>
        Effect.suspend(() => {
          if (
            command !== target.command ||
            caller?.appId !== target.match.appId ||
            !target.entries.every(([key, value]) =>
              isDeepStrictEqual(args[key], value),
            )
          ) {
            return execute.call(registry, command, args, caller, submission);
          }
          registry.execute = execute;
          state.pending = true;
          return Effect.andThen(
            Effect.promise(() => resumed),
            Effect.suspend(() =>
              execute.call(registry, command, args, caller, submission),
            ),
          ).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                state.completed = true;
              }),
            ),
          );
        });
    },
    {
      command,
      match: { appId: match.appId },
      entries: Object.entries(match.args as Record<string, unknown>),
    },
  );
  return {
    waitUntilPending: () =>
      expect
        .poll(() =>
          app.evaluate(
            () => (globalThis as PauseGlobal).__edenCommandPause?.pending,
          ),
        )
        .toBe(true),
    waitUntilCompleted: () =>
      expect
        .poll(() =>
          app.evaluate(
            () => (globalThis as PauseGlobal).__edenCommandPause?.completed,
          ),
        )
        .toBe(true),
    release: () =>
      app.evaluate(() =>
        (globalThis as PauseGlobal).__edenCommandPause?.release(),
      ),
    dispose: () =>
      app.evaluate(() => {
        const state = globalThis as PauseGlobal;
        state.__edenCommandPause?.release();
        delete state.__edenCommandPause;
      }),
  };
}
