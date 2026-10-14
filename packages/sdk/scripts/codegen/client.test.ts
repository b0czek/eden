import { Project } from "ts-morph";
import { generateClientCode } from "./client";
import { extractCommandHandlers, groupCommandsByNamespace } from "./commands";

function extract(source: string, namespace = "fs") {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile("handler.ts", source);
  return extractCommandHandlers(file.getClassOrThrow("Handler"), namespace);
}

function generate(source: string, namespace = "fs") {
  return generateClientCode(
    groupCommandsByNamespace(extract(source, namespace)),
  );
}

it("extracts public fields from resolved aliases and intersections", () => {
  const commands = extract(`
    interface Address { volume: string; path: string }
    interface Transfer { overwrite?: boolean; from: Address; to: Address }
    class Handler {
      @EdenHandler("cp", { mode: "operation" })
      copy(args: Transfer & { _callerAppId: string }): OperationTask<void> {}
    }
  `);
  expect(commands[0].fields).toHaveLength(3);
  expect(commands[0].fields).toEqual(
    expect.arrayContaining([
      { name: "overwrite", optional: true },
      { name: "from", optional: false },
      { name: "to", optional: false },
    ]),
  );
});

it.each([
  "string",
  "{ a: string } | { b: number }",
  "Record<string, string>",
  "string[]",
  "[string, number]",
  "() => void",
])("rejects unsupported argument shape %s with its command name", (shape) => {
  expect(() =>
    extract(
      `class Handler { @EdenHandler("bad") bad(args: ${shape}): void {} }`,
    ),
  ).toThrow("fs/bad:");
});

it("rejects normalized method and namespace collisions", () => {
  expect(() =>
    generate(`class Handler {
    @EdenHandler("get/su") one(args: {}): void {}
    @EdenHandler("get-su") two(args: {}): void {}
  }`),
  ).toThrow("duplicate client method fs.getSu");
  const source = 'class Handler { @EdenHandler("get") get(args: {}): void {} }';
  expect(() =>
    generateClientCode(
      groupCommandsByNamespace([
        ...extract(source, "file-picker"),
        ...extract(source, "filePicker"),
      ]),
    ),
  ).toThrow("duplicate client namespace filePicker");
});

it("rejects operation submission field collisions", () => {
  expect(() =>
    generate(`class Handler {
    @EdenHandler("copy", { mode: "operation" }) copy(args: { submission?: string }): OperationTask<void> {}
  }`),
  ).toThrow("fs/copy: argument submission conflicts");
});
