import "reflect-metadata";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { OperationHandle, UserProfile } from "@edenapp/types";
import { VolumeManager } from "../../../src/filesystem/VolumeManager";
import {
  createFilesystemCaller,
  registerTestVolume,
} from "../../support/filesystem";
import { OperationManager } from "../../../src/operations/OperationManager";
import { createTestEden, type TestEden } from "../../support/createTestEden";

const appId = "com.example.native-reader";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe("grouped volume removal", () => {
  let eden: TestEden;
  let user: UserProfile;
  beforeEach(async () => {
    eden = await createTestEden();
    ({ user } = await createFilesystemCaller(
      eden,
      appId,
      ["fs/read", "volume/eject"],
      {
        username: "reader",
        name: "Reader",
        directoryRestriction: "reader",
      },
    ));
  });

  afterEach(async () => {
    await eden?.dispose();
  });
  const caller = () => ({
    appId,
    principal: { kind: "user" as const, profile: user },
  });

  it("reserves both partitions at eject acceptance and drains their reader through shutdown", async () => {
    const started = deferred();
    const finish = deferred();
    let hostCalls = 0;
    let content: string | undefined;
    for (const id of ["first", "second"]) {
      const root = await registerTestVolume(
        eden,
        { id, label: id, kind: "removable" },
        {
          ejectGroup: "physical-drive",
          eject: async () => {
            hostCalls++;
            expect(content).toBe("second");
          },
        },
      );
      await fs.writeFile(path.join(root, "notes.txt"), id);
    }
    const file = path.join(eden.paths.root, "second", "notes.txt");
    const reading = eden.runtime
      .resolve(VolumeManager)
      .withVolumes(["second"], async () => {
        started.resolve();
        await finish.promise;
        content = await fs.readFile(file, "utf8");
      });
    const operations = eden.runtime.resolve(OperationManager);
    await started.promise;
    const eject = await eden.execute<OperationHandle>(
      "volume/eject",
      { volume: "first" },
      caller(),
    );
    expect(
      eden.runtime.volumes
        .list()
        .filter((volume) => volume.supportsEject)
        .map((volume) => volume.state),
    ).toEqual(["ejecting", "ejecting"]);
    await expect(
      eden.execute(
        "fs/stat",
        { location: { volume: "second", path: "/notes.txt" } },
        caller(),
      ),
    ).rejects.toThrow("ejecting");
    const disposed = eden.dispose();
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(hostCalls).toBe(0);
      finish.resolve();
      await reading;
      await operations.wait(eject, caller());
      await disposed;
      expect(hostCalls).toBe(1);
    } finally {
      finish.resolve();
      await disposed;
    }
  });

  it("restores both partitions after their shared removal fails and permits retry", async () => {
    let failing = true;
    let calls = 0;
    for (const id of ["first", "second"]) {
      await registerTestVolume(
        eden,
        { id, label: id, kind: "removable" },
        {
          ejectGroup: "physical-drive",
          eject: async () => {
            calls++;
            if (failing) throw new Error("Device busy");
          },
        },
      );
    }
    const outcomes = await Promise.allSettled([
      eden.runtime.volumes.eject("first"),
      eden.runtime.volumes.eject("second"),
    ]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(calls).toBe(1);
    expect(
      eden.runtime.volumes
        .list()
        .filter((volume) => volume.supportsEject)
        .map((volume) => volume.state),
    ).toEqual(["ready", "ready"]);
    failing = false;
    await eden.runtime.volumes.eject("second");
    expect(eden.runtime.volumes.list().map((volume) => volume.id)).toEqual([
      "home",
    ]);
    expect(calls).toBe(2);
  });
});
