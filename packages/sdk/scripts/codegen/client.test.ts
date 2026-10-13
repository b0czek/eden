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

it("unwraps resolved aliases and intersections, grouping optional fields after required fields", () => {
  const commands = extract(`
    interface Address { volume: string; path: string }
    interface Transfer { overwrite?: boolean; from: Address; to: Address }
    class Handler {
      @EdenHandler("cp", { mode: "operation" })
      copy(args: Transfer & { _callerAppId: string }): OperationTask<void> {}
    }
  `);
  expect(commands[0].fields).toEqual([
    { name: "overwrite", optional: true },
    { name: "from", optional: false },
    { name: "to", optional: false },
  ]);
  const code = generateClientCode(groupCommandsByNamespace(commands));
  expect(code).toContain(
    'from: CommandArgs<"fs/cp">["from"], to: CommandArgs<"fs/cp">["to"], options?: Pick<CommandArgs<"fs/cp">, "overwrite"> & { submission?: OperationSubmission }',
  );
  expect(code).toContain('Promise<CommandResult<"fs/cp">>');
  expect(code).toContain("options?.submission");
  expect(code).not.toContain("_callerAppId");
});

it("supports zero arguments, optional-only options, and single required fields", () => {
  const code = generate(`
    class Handler {
      @EdenHandler("empty") empty(args: Record<string, never>): void {}
      @EdenHandler("internal") internal(args: { _callerAppId: string }): void {}
      @EdenHandler("list") list(args: { hidden?: boolean }): string[] {}
      @EdenHandler("stat") stat(args: { location: { volume: string; path: string } }): string {}
    }
  `);
  expect(code).toContain('["empty"]: (): Promise');
  expect(code).toContain('["internal"]: (): Promise');
  expect(code).toContain(
    '["list"]: (options?: Pick<CommandArgs<"fs/list">, "hidden">)',
  );
  expect(code).toContain(
    '["stat"]: (location: CommandArgs<"fs/stat">["location"])',
  );
});

it("normalizes hyphens and slashes and aliases reserved exports and parameters", () => {
  const source = `class Handler {
    @EdenHandler("get/su") get(args: { package: string; options: string; _package?: string; optional?: string }): string {}
    @EdenHandler("read-binary") read(args: {}): void {}
  }`;
  const code = generate(source, "package");
  expect(code).toContain("export { packageCommands as package };");
  expect(code).toContain('["getSu"]: (_package:');
  expect(code).toContain(
    'options_?: Pick<CommandArgs<"package/get/su">, "optional">',
  );
  expect(code).toContain('["readBinary"]');
  expect(generate(source, "file-picker")).toContain("as filePicker");
  expect(generate(source, "package")).toBe(code);
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
