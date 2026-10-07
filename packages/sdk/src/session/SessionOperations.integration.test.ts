import "reflect-metadata";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { OperationHandle } from "@edenapp/types";
import { OperationManager } from "../operations/OperationManager";
import { operationTask } from "../operations/OperationTask";
import { createTestEden, type TestEden } from "../testing/createTestEden";
import { PermissionRegistry } from "../ipc";
import { SessionContext } from "./SessionContext";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("session operation transactions", () => {
  let eden: TestEden;
  afterEach(async () => {
    await eden.dispose();
  });

  it("reserves logout before enqueueing and drains accepted session I/O without a self-deadlock", async () => {
    eden = await createTestEden();
    const profile = await eden.runtime.users.create({
      username: "operator",
      name: "Operator",
      password: "password",
    });
    await eden.runtime.sessions.login(profile.username, "password");
    const session = eden.runtime.resolve(SessionContext);
    const sessionId = session.getSessionId();
    const caller = {
      appId: "session.controller",
      principal: { kind: "user" as const, profile },
      sessionId,
    };
    eden.runtime
      .resolve(PermissionRegistry)
      .registerApp(caller.appId, ["session/manage"]);
    const manager = eden.runtime.resolve(OperationManager);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const file = path.join(eden.paths.root, "session-work");
    const work = manager.submit("integration/session-work", {}, caller, () =>
      operationTask(async () => {
        await blocked;
        await fs.writeFile(file, "drained");
      }),
    );
    const transition = await eden.execute<OperationHandle>(
      "session/logout",
      {},
      caller,
    );
    expect(manager.get(transition, caller).status).toBe("queued");
    await expect(eden.execute("session/logout", {}, caller)).rejects.toThrow(
      "draining",
    );
    await tick();
    expect(session.getCurrentUser()?.username).toBe("operator");
    release();
    await manager.wait(work, caller);
    await expect(manager.wait(transition, caller)).resolves.toEqual({
      success: true,
    });
    expect(await fs.readFile(file, "utf8")).toBe("drained");
    expect(session.getCurrentUser()).toBeNull();
    expect(session.getSessionId()).not.toBe(sessionId);
    expect(() =>
      manager.get(work, { ...caller, sessionId: session.getSessionId() }),
    ).toThrow("access denied");
  });

  it("retains failed authentication as a typed response and allows a subsequent submission", async () => {
    eden = await createTestEden();
    await eden.runtime.users.create({
      username: "operator",
      name: "Operator",
      password: "password",
    });
    const manager = eden.runtime.resolve(OperationManager);
    const handle = await eden.execute<OperationHandle>("session/login", {
      username: "operator",
      password: "wrong",
    });
    await expect(manager.wait(handle)).resolves.toMatchObject({
      success: false,
      error: expect.any(String),
    });
    expect(manager.get(handle)).toMatchObject({
      status: "failed",
      response: { success: false },
    });
    await expect(
      eden.complete("session/login", {
        username: "operator",
        password: "password",
      }),
    ).resolves.toMatchObject({ success: true, user: { username: "operator" } });
  });
});
