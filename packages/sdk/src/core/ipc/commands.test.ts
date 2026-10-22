import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as v from "valibot";
import {
  buildService,
  createEffectRuntime,
} from "../../../tests/support/effect-runtime";
import {
  SessionContext,
  SessionContextLive,
} from "../../desktop/session/context";
import { RuntimeConfig } from "../../runtime/inputs";
import { command, defineController } from "../controllers/controller";
import { fromPromise } from "../effects/io";
import { ExecutionContext, ExecutionContextLive } from "../execution/context";
import { Operations } from "../operations/service";
import { Commands, CommandsLive } from "./commands";
import { Permissions, PermissionsLive } from "./permissions";

const serviceEffects = createEffectRuntime();
afterAll(() => serviceEffects.dispose());

function harness() {
  const execution = serviceEffects.acquireSync(
    buildService(ExecutionContext, ExecutionContextLive).pipe(
      Effect.provideService(RuntimeConfig, {}),
    ),
  );
  const session = serviceEffects.acquireSync(
    buildService(SessionContext, SessionContextLive),
  );
  const effects = createEffectRuntime();
  const permissions = serviceEffects.acquireSync(
    buildService(Permissions, PermissionsLive),
  );
  const commands = serviceEffects.acquireSync(
    buildService(Commands, CommandsLive).pipe(
      Effect.provideService(Permissions, permissions),
      Effect.provideService(SessionContext, session),
      Effect.provideService(ExecutionContext, execution),
      Effect.provideService(Operations, {} as Operations),
    ),
  );
  const registry = {
    ...commands,
    execute: <TResult>(...args: Parameters<typeof commands.execute>) =>
      effects.run(commands.execute<TResult>(...args)),
  };
  return { registry, commands, execution, session, effects, permissions };
}
const profile = {
  username: "operator",
  name: "Operator",
  role: "standard" as const,
  grants: [] as string[],
  createdAt: 1,
  updatedAt: 1,
};

describe("command dispatch", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });
  afterEach(async () => {
    await h.effects.dispose();
  });
  it("executes registered commands and rejects unknown commands", async () => {
    h.registry.registerController(
      defineController("system", {
        commands: {
          ping: command({
            input: v.object({ value: v.number() }),
            handle: ({ value }) => value + 1,
          }),
        },
      }),
    );
    expect(h.registry.getNamespaceCommands("system")).toEqual(["system/ping"]);
    await expect(h.registry.execute("system/ping", { value: 1 })).resolves.toBe(
      2,
    );
    await expect(h.registry.execute("missing/command", {})).rejects.toThrow(
      "Unknown command: missing/command",
    );
  });
  it("executes Effect commands under each trusted caller across asynchronous yields", async () => {
    h.registry.registerController(
      defineController("example", {
        commands: {
          caller: command({
            handle: (_args, caller) =>
              Effect.gen(function* () {
                yield* Effect.yieldNow;
                yield* Effect.promise(() => Promise.resolve());
                return {
                  trusted: caller.appId,
                  current: h.execution.get()?.appId,
                };
              }),
          }),
          adapted: command({
            handle: () => fromPromise(() => Promise.resolve("resolved")),
          }),
          fail: command({
            handle: () => Effect.fail(new Error("service failed")),
          }),
        },
      }),
    );
    const invoke = (appId: string) =>
      h.registry.execute(
        "example/caller",
        {},
        { appId, principal: { kind: "system" } },
      );
    await expect(
      Promise.all([invoke("first"), invoke("second")]),
    ).resolves.toEqual([
      { trusted: "first", current: "first" },
      { trusted: "second", current: "second" },
    ]);
    await expect(h.registry.execute("example/adapted", {})).resolves.toBe(
      "resolved",
    );
    await expect(h.registry.execute("example/fail", {})).rejects.toThrow(
      "service failed",
    );
  });
  it("keeps synchronous programming errors as defects while recovering tagged admission and validation rejections", async () => {
    class AdmissionRejected extends Data.TaggedError("AdmissionRejected")<{
      message: string;
    }> {}
    const defect = new TypeError("Invalid handler state");
    const rejection = new AdmissionRejected({
      message: "Resource unavailable",
    });
    h.registry.registerController(
      defineController("admission", {
        commands: {
          defect: command({
            handle: () => {
              throw defect;
            },
          }),
          effectDefect: command({
            handle: () =>
              Effect.sync(() => {
                throw defect;
              }),
          }),
          adaptedFailure: command({
            handle: () => fromPromise(() => Promise.reject(defect)),
          }),
          rejected: command({
            handle: () => {
              throw rejection;
            },
          }),
          validated: command({
            input: v.object({ value: v.number() }),
            handle: ({ value }) => value,
          }),
        },
      }),
    );
    const runExit = (name: string) =>
      h.effects.run(Effect.exit(h.commands.execute(`admission/${name}`, {})));
    for (const name of ["defect", "effectDefect"]) {
      const failed = await runExit(name);
      expect(Exit.isFailure(failed)).toBe(true);
      if (Exit.isFailure(failed)) {
        expect(Cause.hasDies(failed.cause)).toBe(true);
        expect(Cause.hasFails(failed.cause)).toBe(false);
        expect(Cause.squash(failed.cause)).toBe(defect);
      }
    }
    const adapted = await runExit("adaptedFailure");
    expect(Exit.isFailure(adapted)).toBe(true);
    if (Exit.isFailure(adapted)) {
      expect(Cause.hasDies(adapted.cause)).toBe(false);
      expect(Cause.hasFails(adapted.cause)).toBe(true);
      expect(Cause.squash(adapted.cause)).toBe(defect);
    }
    const rejected = await runExit("rejected");
    expect(Exit.isFailure(rejected)).toBe(true);
    if (Exit.isFailure(rejected)) {
      expect(Cause.hasDies(rejected.cause)).toBe(false);
      expect(Cause.hasFails(rejected.cause)).toBe(true);
      expect(Cause.squash(rejected.cause)).toBe(rejection);
    }
    const invalid = await runExit("validated");
    expect(Exit.isFailure(invalid)).toBe(true);
    if (Exit.isFailure(invalid)) {
      expect(Cause.hasDies(invalid.cause)).toBe(false);
      expect(v.isValiError(Cause.squash(invalid.cause))).toBe(true);
    }
  });
  it("rejects duplicate commands without replacing the existing controller", async () => {
    const first = defineController("example", {
      commands: { read: command({ handle: () => "first" }) },
    });
    h.registry.registerController(first);
    expect(() =>
      h.registry.registerController(
        defineController("example", {
          commands: { read: command({ handle: () => "second" }) },
        }),
      ),
    ).toThrow("Command already registered: example/read");
    await expect(h.registry.execute("example/read", {})).resolves.toBe("first");
  });
  it("uses the session principal for interactive calls and keeps trusted caller metadata separate from input", async () => {
    h.session.setCurrentUser(profile);
    h.registry.registerController(
      defineController("system", {
        commands: {
          whoami: command({
            input: v.object({ value: v.number() }),
            handle: (args, caller) => ({
              args,
              caller,
              principal: h.execution.getPrincipal(),
            }),
          }),
        },
      }),
    );
    await expect(
      h.registry.execute("system/whoami", {
        value: 1,
        _callerAppId: "spoofed",
        _isFoundation: true,
      }),
    ).resolves.toMatchObject({
      args: { value: 1 },
      principal: { kind: "user", profile },
    });
    const caller = {
      appId: "app.one",
      webContentsId: 42,
      foundation: false,
      principal: { kind: "user" as const, profile },
    };
    await expect(
      h.registry.execute(
        "system/whoami",
        { value: 1, _callerAppId: "spoofed" },
        caller,
      ),
    ).resolves.toMatchObject({ args: { value: 1 }, caller });
  });
  it("enforces permissions and declared grants while accepting base permissions", async () => {
    h.registry.registerController(
      defineController("files", {
        commands: {
          read: command({ permission: "read", handle: () => "secured" }),
        },
      }),
    );
    await expect(
      h.registry.execute("files/read", {}, { appId: "app.one" }),
    ).rejects.toThrow("Caller principal could not be resolved");
    const caller = {
      appId: "app.one",
      principal: {
        kind: "user" as const,
        profile: { ...profile, grants: [] as string[] },
      },
    };
    await expect(h.registry.execute("files/read", {}, caller)).rejects.toThrow(
      "Permission denied",
    );
    h.permissions.registerApp(
      "app.one",
      [],
      [
        {
          scope: "preset",
          id: "files/read",
          label: "Read files",
          preset: "files/read",
          permissions: ["files/read"],
        },
      ],
    );
    await expect(h.registry.execute("files/read", {}, caller)).rejects.toThrow(
      "Grant denied",
    );
    caller.principal.profile.grants.push("preset/files/read");
    await expect(h.registry.execute("files/read", {}, caller)).resolves.toBe(
      "secured",
    );
    h.permissions.registerApp("app.one", ["files/read"]);
    caller.principal.profile.grants = [];
    await expect(h.registry.execute("files/read", {}, caller)).resolves.toBe(
      "secured",
    );
  });
  it("limits foundation to its explicit command capabilities", async () => {
    h.registry.registerController(
      defineController("appearance", {
        commands: { "get-wallpaper": command({ handle: () => "allowed" }) },
      }),
    );
    h.registry.registerController(
      defineController("process", {
        commands: { launch: command({ handle: () => "denied" }) },
      }),
    );
    await expect(
      h.registry.execute("appearance/get-wallpaper", {}, { foundation: true }),
    ).resolves.toBe("allowed");
    await expect(
      h.registry.execute("process/launch", {}, { foundation: true }),
    ).rejects.toThrow("Foundation is not allowed");
  });
});
