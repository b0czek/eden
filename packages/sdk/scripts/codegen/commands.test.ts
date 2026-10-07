import assert from "node:assert/strict";
import { Project } from "ts-morph";
import {
  extractCommandHandlers,
  generateCommandsCode,
  groupCommandsByNamespace,
} from "./commands";

const project = new Project({ useInMemoryFileSystem: true });
const source = project.createSourceFile(
  "fixture.ts",
  `
class Fixture {
  @EdenHandler("read") read(): Promise<string> { throw 0; }
  @EdenHandler("copy", {mode: "operation"}) copy(): OperationTask<boolean> { throw 0; }
  @EdenHandler("scan", {mode: "stream"}) scan(): StreamTask<number, string> { throw 0; }
}`,
);
const commands = extractCommandHandlers(
  source.getClassOrThrow("Fixture"),
  "fixture",
);
const generated = generateCommandsCode(
  groupCommandsByNamespace(commands),
  new Set(),
);
assert.match(generated, /mode: "immediate";[\s\S]*response: string;/);
assert.match(
  generated,
  /OperationHandle<"fixture\/copy">;\s*completion: boolean;/,
);
assert.match(
  generated,
  /StreamHandle<"fixture\/scan">;\s*completion: string;\s*chunk: number;/,
);
console.log("Command mode code generation verified");
