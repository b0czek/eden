import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sdk = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const cli = require.resolve("@effect/language-service/cli.js");

test("SDK Effect diagnostics enforce correctness without rejecting scoped factories", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "eden-effect-checks-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await symlink(
    path.join(sdk, "node_modules"),
    path.join(directory, "node_modules"),
    "junction",
  );
  const project = path.join(directory, "tsconfig.json");
  await writeFile(
    project,
    JSON.stringify({
      extends: path.join(sdk, "tsconfig.json"),
      compilerOptions: {
        rootDir: directory,
        outDir: path.join(directory, "dist"),
      },
      include: ["fixture.ts"],
      exclude: [],
    }),
  );

  const check = async (source, boundaries = false) => {
    await writeFile(path.join(directory, "fixture.ts"), source);
    const result = spawnSync(
      process.execPath,
      boundaries
        ? [
            fileURLToPath(
              new URL("check-effect-boundaries.mjs", import.meta.url),
            ),
            project,
          ]
        : [
            cli,
            "diagnostics",
            "--project",
            project,
            "--format",
            "text",
            "--severity",
            "error",
          ],
      { cwd: sdk, encoding: "utf8", timeout: 60_000 },
    );
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    return { status: result.status, output: result.stdout + result.stderr };
  };

  await t.test(
    "accepts scoped acquisition and fully provided methods",
    async () => {
      const result = await check(`
      import * as Effect from "effect/Effect";
      export const make = Effect.gen(function* () {
        yield* Effect.scope;
        yield* Effect.addFinalizer(() => Effect.void);
        return { read: () => Effect.succeed("ready") };
      });
    `);
      assert.equal(result.status, 0, result.output);
    },
  );

  await t.test(
    "fails for dropped work, hidden requirements, lazy Promises and native timers",
    async () => {
      const result = await check(`
      import * as Effect from "effect/Effect";
      import type * as Scope from "effect/Scope";
      Effect.succeed("dropped work");
      export const unsafe = Effect.scope as Effect.Effect<Scope.Scope>;
      export const hiddenPromise = Effect.sync(() => Promise.resolve(1));
      export const timer = setTimeout(() => {}, 1);
    `);
      assert.equal(result.status, 1, result.output);
      for (const rule of [
        "floatingEffect",
        "unsafeEffectTypeAssertion",
        "lazyPromiseInEffectSync",
        "globalTimers",
      ]) {
        assert.ok(result.output.includes(`effect(${rule})`), result.output);
      }
    },
  );
  await t.test(
    "rejects requirements in individual factory methods, including Promise results and unions",
    async () => {
      const result = await check(
        `
      import * as Effect from "effect/Effect";
      const make = () => ({
        direct: () => Effect.scope,
        promised: async () => Effect.scope,
        conditional: () => Math.random() ? Effect.scope : Effect.succeed(1),
        ready: () => Effect.void,
        files: { read: () => Effect.scope },
        invented: <R>(): Effect.Effect<void, never, R> => Effect.void,
      });
      export { make as createBroken };
    `,
        true,
      );
      assert.equal(result.status, 1, result.output);
      assert.ok(
        result.output.includes("createBroken.invented requires R"),
        result.output,
      );
      for (const method of ["direct", "promised", "conditional", "files.read"])
        assert.ok(
          result.output.includes(`createBroken.${method} requires Scope`),
          result.output,
        );
    },
  );

  await t.test(
    "rejects individual service method requirements while allowing acquisition and generic combinators",
    async () => {
      const result = await check(
        `
      import * as Context from "effect/Context";
      import * as Effect from "effect/Effect";
      import * as Layer from "effect/Layer";
      interface Worker {
        ready(): Effect.Effect<void>;
        leaked(): Effect.Effect<unknown, never, "dependency">;
        preserve<A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
      }
      export const Worker = Context.Service<"Worker", Worker>("Worker");
      export const WorkerLive = Layer.effect(Worker, Effect.gen(function* () {
        yield* Effect.scope;
        return { ready: () => Effect.void, leaked: () => Effect.void, preserve: (work) => work };
      }));
    `,
        true,
      );
      assert.equal(result.status, 1, result.output);
      assert.ok(
        result.output.includes("Worker.leaked requires"),
        result.output,
      );
      assert.ok(
        !result.output.includes("Worker.ready requires"),
        result.output,
      );
      assert.ok(
        !result.output.includes("Worker.preserve requires"),
        result.output,
      );
      assert.ok(!result.output.includes("WorkerLive requires"), result.output);
    },
  );

  await t.test(
    "rejects raw interpreters and detached fibers through aliases and computed access",
    async () => {
      const result = await check(
        `
      import * as E from "effect/Effect";
      import { runPromise as interpret, forkDetach as detach } from "effect/Effect";
      import * as ManagedRuntime from "effect/ManagedRuntime";
      import * as Layer from "effect/Layer";
      export const run = () => interpret(E.void);
      export const copied = E["runSync"];
      export const background = () => detach(E.void);
      export const runtime = ManagedRuntime.make(Layer.empty);
    `,
        true,
      );
      assert.equal(result.status, 1, result.output);
      assert.equal(
        result.output.match(/eden\/domain-interpreter/g)?.length,
        3,
        result.output,
      );
      assert.ok(result.output.includes("eden/unowned-fiber"), result.output);
    },
  );

  await t.test(
    "rejects destructured interpreters and detached forks, including renamed properties",
    async () => {
      const result = await check(
        `
      import * as Effect from "effect/Effect";
      import * as ManagedRuntime from "effect/ManagedRuntime";
      import * as Layer from "effect/Layer";
      const { runPromise, forkDetach } = Effect;
      const { make } = ManagedRuntime;
      const { runSync: execute } = Effect;
      export const createEscaped = () => ({
        read: () => runPromise(Effect.void),
        watch: () => forkDetach(Effect.void),
        runtime: () => make(Layer.empty),
        execute: () => execute(Effect.void),
      });
    `,
        true,
      );
      assert.equal(result.status, 1, result.output);
      assert.equal(
        result.output.match(/eden\/domain-interpreter/g)?.length,
        3,
        result.output,
      );
      assert.equal(
        result.output.match(/eden\/unowned-fiber/g)?.length,
        1,
        result.output,
      );
    },
  );

  await t.test(
    "accepts owned fibers, generic composition and explained adapter exceptions",
    async () => {
      const result = await check(
        `
      import * as Effect from "effect/Effect";
      export const createWorker = Effect.fn(function* () {
        yield* Effect.forkScoped(Effect.void);
        return {
          read: () => Effect.void,
          files: { read: () => Effect.void },
          preserve: <A, E, R>(work: Effect.Effect<A, E, R>) => work,
          // @eden-effect-next-line unresolved-requirements -- Acquire the resource in its caller-owned scope.
          acquire: () => Effect.scope,
        };
      });
      export const nativeCallback = () => {
        // @eden-effect-next-line domain-interpreter -- Native callback returns a Promise and awaits its work.
        return Effect.runPromise(Effect.void);
      };
      const unrelated = { runPromise: () => 1, forkDetach: () => 2 };
      const { runPromise, forkDetach } = unrelated;
      export const ordinary = runPromise() + forkDetach();
      interface Nested { read(): Effect.Effect<void>; child?: Nested }
      const nested: Nested = { read: () => Effect.void };
      nested.child = nested;
      export const createNested = () => ({ first: nested, second: nested });
    `,
        true,
      );
      assert.equal(result.status, 0, result.output);
    },
  );

  await t.test(
    "rejects exceptions without a reason and stale exceptions",
    async () => {
      const result = await check(
        `
      // @eden-effect-next-line domain-interpreter
      export const first = 1;
      // @eden-effect-next-line unowned-fiber -- This used to create a detached fiber.
      export const second = 2;
    `,
        true,
      );
      assert.equal(result.status, 1, result.output);
      assert.ok(
        result.output.includes("eden/invalid-exception"),
        result.output,
      );
      assert.ok(result.output.includes("eden/unused-exception"), result.output);
    },
  );
});
