import * as path from "node:path";
import { isPathWithin } from "./lexical-path";

it("distinguishes descendants from parents and sibling prefixes", () => {
  const root = path.resolve("root");
  for (const relative of ["nested/file", "..notes", "..notes/file"]) {
    expect(isPathWithin(root, path.join(root, relative))).toBe(true);
  }
  for (const target of [path.dirname(root), `${root}-sibling/file`]) {
    expect(isPathWithin(root, target)).toBe(false);
  }
});

it("lets callers decide whether the root itself is allowed", () => {
  const root = path.resolve("root");
  const equivalent = path.join(root, "nested", "..");
  expect(isPathWithin(root, equivalent)).toBe(true);
  expect(isPathWithin(root, equivalent, { allowRoot: false })).toBe(false);
  expect(
    isPathWithin(root, path.join(root, "file"), { allowRoot: false }),
  ).toBe(true);
});
