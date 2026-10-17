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

  const check = async (source) => {
    await writeFile(path.join(directory, "fixture.ts"), source);
    const result = spawnSync(
      process.execPath,
      [
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
});
