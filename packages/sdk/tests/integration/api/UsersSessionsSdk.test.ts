import type {
  EdenCreateUserInput,
  EdenUpdateUserInput,
} from "../../../src/api/ControlPlaneApi";
import { createTestEden } from "../../support/createTestEden";

it("validates host user writes before persistence or current-session changes", async () => {
  const eden = await createTestEden();
  try {
    const user = await eden.runtime.users.create({
      username: "operator",
      name: "Operator",
      password: "password",
    });
    await eden.runtime.sessions.login(user.username, "password");
    const changes: unknown[] = [];
    const stop = eden.runtime.sessions.onChanged((change) => {
      changes.push(change);
    });
    try {
      await expect(
        eden.runtime.users.create({
          username: "invalid-role",
          name: "Invalid",
          password: "password",
          role: "administrator",
        } as unknown as EdenCreateUserInput),
      ).rejects.toMatchObject({ name: "ValiError" });
      await expect(
        eden.runtime.users.update({
          username: user.username,
          role: "administrator",
        } as unknown as EdenUpdateUserInput),
      ).rejects.toMatchObject({ name: "ValiError" });
      await expect(
        eden.runtime.users.setDefaultUsername([] as unknown as string),
      ).rejects.toMatchObject({ name: "ValiError" });
      expect(await eden.runtime.users.get("invalid-role")).toBeNull();
      expect(await eden.runtime.users.get(user.username)).toMatchObject({
        role: "standard",
        name: "Operator",
      });
      expect(eden.runtime.users.getDefaultUsername()).toBeNull();
      expect(eden.runtime.sessions.current()).toMatchObject({
        role: "standard",
        name: "Operator",
      });
      expect(changes).toEqual([]);
    } finally {
      stop();
    }
  } finally {
    await eden.dispose();
  }
});

it("rejects malformed host login before recording or reserving a session transition", async () => {
  const eden = await createTestEden();
  try {
    const user = await eden.runtime.users.create({
      username: "operator",
      name: "Operator",
      password: "password",
    });
    const previousOperations = eden.runtime.operations.list();
    await expect(
      eden.runtime.sessions.login(user.username, {
        secret: "password",
      } as unknown as string),
    ).rejects.toMatchObject({ name: "ValiError" });
    expect(eden.runtime.operations.list()).toEqual(previousOperations);
    expect(eden.runtime.sessions.current()).toBeNull();
    await expect(
      eden.runtime.sessions.login(user.username, "password"),
    ).resolves.toMatchObject({ username: user.username });
  } finally {
    await eden.dispose();
  }
});

it("delivers host session observers with system authority when called inside an app context", async () => {
  const eden = await createTestEden();
  try {
    const user = await eden.runtime.users.create({
      username: "operator",
      name: "Operator",
      password: "password",
    });
    await eden.runtime.sessions.login(user.username, "password");
    const execution = eden.runtime.services.execution;
    const observed: unknown[] = [];
    const stop = eden.runtime.sessions.onChanged(() => {
      observed.push(structuredClone(execution.get()));
    });
    try {
      await execution.run(
        {
          appId: "app.foreign",
          sessionId: "foreign-session",
          operationId: "foreign-operation",
          principal: { kind: "user", profile: user },
        },
        () =>
          eden.runtime.users.update({
            username: user.username,
            name: "Updated",
          }),
      );
      expect(observed).toEqual([{ principal: { kind: "system" } }]);
      expect(eden.runtime.sessions.current()?.name).toBe("Updated");
    } finally {
      stop();
    }
  } finally {
    await eden.dispose();
  }
});
