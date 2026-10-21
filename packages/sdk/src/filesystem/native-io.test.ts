import fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import { gate, tick } from "../../tests/support/async";
import { createEffectRuntime } from "../../tests/support/effect-runtime";
import { FilesystemAccessDenied } from "./errors";
import { io } from "./native-io";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "eden-native-io-"));
});
afterEach(async () => {
  jest.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

it("retains the native path, errno and cause for filesystem failure recovery", async () => {
  const missing = path.join(root, "missing");
  await expect(Effect.runPromise(io.stat(missing))).rejects.toMatchObject({
    _tag: "FilesystemIoFailed",
    operation: "stat",
    path: missing,
    code: "ENOENT",
    cause: expect.objectContaining({ code: "ENOENT", path: missing }),
    message: expect.stringContaining("Filesystem stat failed:"),
  });
});

it("closes a descriptor with its scope and retains its context on subsequent read failure", async () => {
  const hostPath = path.join(root, "data");
  await fs.writeFile(hostPath, "contents");
  const file = await Effect.runPromise(Effect.scoped(io.open(hostPath)));
  await expect(
    Effect.runPromise(file.read(Buffer.alloc(1), 0)),
  ).rejects.toMatchObject({
    _tag: "FilesystemIoFailed",
    operation: "read",
    path: hostPath,
    descriptor: file.descriptor,
    code: "EBADF",
    cause: expect.objectContaining({ code: "EBADF" }),
  });
});

it.each([false, true])(
  "preserves tree contents, empty directories, links and modes (progress=%s)",
  async (withProgress) => {
    const source = path.join(root, "source");
    const destination = path.join(root, "destination");
    await fs.mkdir(path.join(source, "empty"), { recursive: true });
    await fs.writeFile(path.join(source, "data"), "payload");
    await fs.symlink("../missing", path.join(source, "link"));
    await fs.chmod(source, 0o751);
    await fs.chmod(path.join(source, "empty"), 0o750);
    await fs.chmod(path.join(source, "data"), 0o640);
    let bytes = 0;
    await Effect.runPromise(
      io.copy(source, destination, {
        onBytes: withProgress
          ? (count) => {
              bytes += count;
            }
          : undefined,
      }),
    );
    expect(await fs.readFile(path.join(destination, "data"), "utf-8")).toBe(
      "payload",
    );
    expect(await fs.readFile(path.join(source, "data"), "utf-8")).toBe(
      "payload",
    );
    expect(await fs.readdir(path.join(destination, "empty"))).toEqual([]);
    expect(await fs.readlink(path.join(destination, "link"))).toBe(
      "../missing",
    );
    for (const entry of ["", "empty", "data"]) {
      expect((await fs.stat(path.join(destination, entry))).mode & 0o777).toBe(
        (await fs.stat(path.join(source, entry))).mode & 0o777,
      );
    }
    expect(bytes).toBe(withProgress ? 7 : 0);
  },
);

describe("atomic file writes", () => {
  it.each([
    {
      content: "hello",
      encoding: "utf16le" as const,
      bytes: Buffer.from("hello", "utf16le"),
    },
    {
      content: new Uint8Array([0, 128, 255]),
      encoding: undefined,
      bytes: Buffer.from([0, 128, 255]),
    },
  ])(
    "creates a complete file with $encoding encoding",
    async ({ content, encoding, bytes }) => {
      const target = path.join(root, "state");
      await Effect.runPromise(io.writeFileAtomic(target, content, encoding));
      expect(await fs.readFile(target)).toEqual(bytes);
      expect(await fs.readdir(root)).toEqual(["state"]);
    },
  );

  it("keeps the old file visible until replacement and isolates overlapping writes", async () => {
    const target = path.join(root, "state");
    await fs.writeFile(target, "old");
    const ready = gate();
    const finish = gate();
    const nativeRename = fs.rename;
    jest
      .spyOn(fs, "rename")
      .mockImplementationOnce(async (source, destination) => {
        ready.release();
        await finish.promise;
        return nativeRename(source, destination);
      });
    const first = Effect.runPromise(io.writeFileAtomic(target, "first"));
    try {
      await ready.promise;
      expect(await fs.readFile(target, "utf-8")).toBe("old");
      await Effect.runPromise(io.writeFileAtomic(target, "second"));
      expect(await fs.readFile(target, "utf-8")).toBe("second");
      finish.release();
      await first;
      expect(await fs.readFile(target, "utf-8")).toBe("first");
      expect(await fs.readdir(root)).toEqual(["state"]);
    } finally {
      finish.release();
      await first;
    }
  });

  it.each(["writeFile", "rename"] as const)(
    "preserves the old file and removes temporary data when %s fails",
    async (operation) => {
      const target = path.join(root, "state");
      await fs.writeFile(target, "old");
      const failure = Object.assign(new Error("write failed"), { code: "EIO" });
      if (operation === "writeFile") {
        const nativeWrite = fs.writeFile;
        jest.spyOn(fs, "writeFile").mockImplementationOnce(async (file) => {
          await nativeWrite(file, "partial");
          throw failure;
        });
      } else {
        jest.spyOn(fs, "rename").mockRejectedValueOnce(failure);
      }
      await expect(
        Effect.runPromise(io.writeFileAtomic(target, "new")),
      ).rejects.toMatchObject({
        _tag: "FilesystemIoFailed",
        operation,
        code: "EIO",
        cause: failure,
      });
      expect(await fs.readFile(target, "utf-8")).toBe("old");
      expect(await fs.readdir(root)).toEqual(["state"]);
    },
  );

  it("drains an interrupted write before removing temporary data", async () => {
    const runtime = createEffectRuntime();
    const target = path.join(root, "state");
    await fs.writeFile(target, "old");
    const started = gate();
    const finish = gate();
    const nativeWrite = fs.writeFile;
    jest
      .spyOn(fs, "writeFile")
      .mockImplementationOnce(async (file, data, options) => {
        started.release();
        await finish.promise;
        await nativeWrite(file, data, options);
      });
    const fiber = runtime.fork(io.writeFileAtomic(target, "new"));
    try {
      await started.promise;
      fiber.interruptUnsafe();
      await tick();
      expect(fiber.pollUnsafe()).toBeUndefined();
      finish.release();
      const exit = await runtime.run(Fiber.await(fiber));
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
        true,
      );
      expect(await fs.readFile(target, "utf-8")).toBe("old");
      expect(await fs.readdir(root)).toEqual(["state"]);
    } finally {
      finish.release();
      await runtime.dispose();
    }
  });
});

it("returns watch admission failures in the typed error channel", async () => {
  const missing = path.join(root, "missing");
  await expect(
    Effect.runPromise(
      io.watch(
        missing,
        () => {},
        () => {},
      ),
    ),
  ).rejects.toMatchObject({
    _tag: "FilesystemIoFailed",
    operation: "watch",
    path: missing,
    message: `Cannot watch filesystem path '${missing}'`,
    code: "ENOENT",
    cause: expect.objectContaining({ code: "ENOENT" }),
  });
});

it("waits for non-cancellable metadata I/O before releasing ownership on interruption", async () => {
  const runtime = createEffectRuntime();
  const started = gate();
  const finish = gate();
  const nativeStat = fs.stat;
  jest.spyOn(fs, "stat").mockImplementation((async (...args: unknown[]) => {
    started.release();
    await finish.promise;
    return Reflect.apply(nativeStat, undefined, args);
  }) as typeof fs.stat);
  let released = false;
  const fiber = runtime.fork(
    io.stat(root).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          released = true;
        }),
      ),
    ),
  );
  try {
    await started.promise;
    fiber.interruptUnsafe();
    await tick();
    expect(released).toBe(false);
    finish.release();
    const exit = await runtime.run(Fiber.await(fiber));
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
      true,
    );
    expect(released).toBe(true);
  } finally {
    finish.release();
    await runtime.dispose();
  }
});

it("interrupts copy access checks and waits for their cleanup before releasing ownership", async () => {
  const runtime = createEffectRuntime();
  const started = gate();
  const interrupted = gate();
  const finish = gate();
  const source = path.join(root, "source");
  const destination = path.join(root, "destination");
  await fs.writeFile(source, "contents");
  let released = false;
  const fiber = runtime.fork(
    io
      .copy(source, destination, {
        checkAccess: () =>
          Effect.andThen(
            Effect.sync(() => started.release()),
            Effect.never,
          ).pipe(
            Effect.onInterrupt(() =>
              Effect.promise(() => {
                interrupted.release();
                return finish.promise;
              }),
            ),
          ),
      })
      .pipe(
        Effect.ensuring(
          Effect.sync(() => {
            released = true;
          }),
        ),
      ),
  );
  try {
    await started.promise;
    fiber.interruptUnsafe();
    await interrupted.promise;
    expect(released).toBe(false);
    expect(fiber.pollUnsafe()).toBeUndefined();
    finish.release();
    const exit = await runtime.run(Fiber.await(fiber));
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
      true,
    );
    expect(released).toBe(true);
    await expect(fs.stat(destination)).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    finish.release();
    await runtime.dispose();
  }
});

it.each(["failure", "defect"] as const)(
  "preserves a copy access check's %s",
  async (kind) => {
    const source = path.join(root, "source");
    const destination = path.join(root, "destination");
    await fs.writeFile(source, "contents");
    const error = new FilesystemAccessDenied({
      message: "Source disconnected",
    });
    const exit = await Effect.runPromiseExit(
      io.copy(source, destination, {
        checkAccess: () =>
          kind === "failure" ? Effect.fail(error) : Effect.die(error),
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(
        kind === "failure"
          ? Cause.hasFails(exit.cause) && !Cause.hasDies(exit.cause)
          : Cause.hasDies(exit.cause) && !Cause.hasFails(exit.cause),
      ).toBe(true);
      expect(Cause.squash(exit.cause)).toBe(error);
    }
    await expect(fs.stat(destination)).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("preserves a progress callback defect while draining the copy streams", async () => {
  const source = path.join(root, "source");
  const destination = path.join(root, "destination");
  await fs.writeFile(source, "contents");
  const defect = new Error("Progress reporter failed");
  const exit = await Effect.runPromiseExit(
    io.copy(source, destination, {
      onBytes: () => {
        throw defect;
      },
    }),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(Cause.hasDies(exit.cause)).toBe(true);
    expect(Cause.hasFails(exit.cause)).toBe(false);
    expect(Cause.squash(exit.cause)).toBe(defect);
  }
});
