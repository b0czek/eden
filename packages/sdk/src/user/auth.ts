import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import * as Effect from "effect/Effect";
import { fromPromise } from "../effects/io";
import { PasswordDerivationError } from "./errors";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

export const hashPassword = Effect.fn(function* (password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (yield* fromPromise(
    () => scryptAsync(password, salt, 64),
    (cause) => new PasswordDerivationError({ operation: "hash", cause }),
  )).toString("hex");
  return { passwordHash: hash, passwordSalt: salt };
});

export const verifyPassword = Effect.fn(function* (
  password: string,
  salt: string,
  hash: string,
) {
  const candidate = yield* fromPromise(
    () => scryptAsync(password, salt, 64),
    (cause) => new PasswordDerivationError({ operation: "verify", cause }),
  );
  const hashBuf = Buffer.from(hash, "hex");
  if (hashBuf.length !== candidate.length) {
    return false;
  }
  return timingSafeEqual(candidate, hashBuf);
});
