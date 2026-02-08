import { hashPassword, verifyPassword } from "./UserAuth";

describe("UserAuth", () => {
  it("hashes and verifies passwords", async () => {
    const password = "correct-horse-battery-staple";
    const { passwordHash, passwordSalt } = await hashPassword(password);

    expect(passwordHash).toBeDefined();
    expect(passwordSalt).toBeDefined();
    expect(passwordHash.length).toBeGreaterThan(0);
    expect(passwordSalt.length).toBeGreaterThan(0);

    await expect(
      verifyPassword(password, passwordSalt, passwordHash),
    ).resolves.toBe(true);

    await expect(
      verifyPassword("wrong-password", passwordSalt, passwordHash),
    ).resolves.toBe(false);
  });

  it("uses unique salts for subsequent hashes", async () => {
    const password = "repeatable";
    const first = await hashPassword(password);
    const second = await hashPassword(password);

    expect(first.passwordSalt).not.toEqual(second.passwordSalt);
    expect(first.passwordHash).not.toEqual(second.passwordHash);
  });

  it("returns false when hash length is invalid", async () => {
    const { passwordSalt } = await hashPassword("password");

    await expect(
      verifyPassword("password", passwordSalt, "deadbeef"),
    ).resolves.toBe(false);
  });
});
