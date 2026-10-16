import * as path from "node:path";
import { Project } from "ts-morph";
import { generateClientCode } from "./client";
import { groupCommandsByNamespace } from "./commands";
import { extractControllers } from "./controllers";
import type { NamespaceEvents } from "./events";

const project = new Project({
  tsConfigFilePath: path.join(__dirname, "../../tsconfig.json"),
  skipAddingFilesFromTsConfig: true,
});
let fixtureId = 0;

function extract(commands: string, namespace = "fs", declarations = "") {
  const fixture = project.createSourceFile(
    path.join(
      __dirname,
      `../../src/controllers/client-${fixtureId++}.fixture.ts`,
    ),
    `
    import * as v from "valibot";
    import { command, defineController } from "./controller";
    import { operationTask } from "../operations/task";
    ${declarations}
    export const fixture = defineController(${JSON.stringify(namespace)}, {
      commands: { ${commands} },
    });
    `,
  );
  return extractControllers(fixture).commands;
}

function generate(commands: string, namespace = "fs") {
  return generateClientCode(
    groupCommandsByNamespace(extract(commands, namespace)),
  );
}

it("extracts public fields from resolved aliases and intersections", () => {
  const commands = extract(
    `
    cp: command({
      input: transfer,
      mode: "operation",
      handle: () => operationTask(async () => {}),
    }),
  `,
    "fs",
    `
    interface Address { volume: string; path: string }
    interface Transfer { overwrite?: boolean; from: Address }
    declare const transfer: v.GenericSchema<Transfer & { to: Address }>;
  `,
  );
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
  ["string", "v.string()"],
  [
    "union",
    "v.union([v.object({ a: v.string() }), v.object({ b: v.number() })])",
  ],
  ["record", "v.record(v.string(), v.string())"],
  ["array", "v.array(v.string())"],
  ["tuple", "v.tuple([v.string(), v.number()])"],
  ["function", "v.function()"],
])(
  "rejects unsupported %s arguments with their command name",
  (_shape, schema) => {
    expect(() =>
      extract(`bad: command({ input: ${schema}, handle: () => {} })`),
    ).toThrow("fs/bad:");
  },
);

it("rejects normalized method and namespace collisions", () => {
  expect(() =>
    generate(`
    "get/su": command({ handle: () => {} }),
    "get-su": command({ handle: () => {} }),
  `),
  ).toThrow("duplicate client method fs.getSu");
  const source = "get: command({ handle: () => {} })";
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
    generate(`
    copy: command({
      input: v.object({ submission: v.optional(v.string()) }),
      mode: "operation",
      handle: () => operationTask(async () => {}),
    }),
  `),
  ).toThrow("fs/copy: argument submission conflicts");
});

const events: NamespaceEvents[] = [
  {
    namespace: "file-picker",
    interfaceName: "FilePickerEvents",
    events: [
      { eventName: "closed", payloadType: "{ requestId: string }", docs: [] },
    ],
  },
];

it.each(["subscribe", "unsubscribe"])(
  "rejects a command that would replace the generated %s method",
  (method) => {
    const commands = groupCommandsByNamespace(
      extract(`"${method}": command({ handle: () => {} })`, "file-picker"),
    );
    expect(() => generateClientCode(commands, events)).toThrow(
      `file-picker/${method}: client method filePicker.${method} is reserved for event subscriptions`,
    );
  },
);

it("rejects normalized namespace collisions between command and event domains", () => {
  const commands = groupCommandsByNamespace(
    extract("get: command({ handle: () => {} })", "filePicker"),
  );
  expect(() => generateClientCode(commands, events)).toThrow(
    "duplicate client namespace filePicker",
  );
});

it("generates a typed client for an event-only domain", () => {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: true },
  });
  project.createSourceFile(
    "/types.d.ts",
    `
    declare module "@edenapp/types" {
      export type CommandArgs<C> = {};
      export type CommandResult<C> = void;
      export type OperationSubmission = {};
      export type EventData<E extends "file-picker/closed"> = { requestId: string };
    }
  `,
  );
  project.createSourceFile(
    "/invoke.ts",
    "export declare function invoke(command: string, args: unknown): Promise<void>;",
  );
  project.createSourceFile(
    "/subscriptions.ts",
    `
    export declare function subscribe(event: "file-picker/closed", callback: (data: { requestId: string }) => void): Promise<void>;
    export declare function unsubscribe(event: "file-picker/closed", callback: (data: { requestId: string }) => void): void;
  `,
  );
  project.createSourceFile("/client.ts", generateClientCode([], events));
  project.createSourceFile(
    "/consumer.ts",
    `
    import { filePicker } from "./client";
    const handler = (event: { requestId: string }) => {};
    const ready: Promise<void> = filePicker.subscribe("closed", event => {
      const requestId: string = event.requestId;
      // @ts-expect-error payloads are inferred from the event declaration
      event.missing;
    });
    const stopped: void = filePicker.unsubscribe("closed", handler);
    // @ts-expect-error undeclared events are unavailable
    filePicker.subscribe("opened", handler);
  `,
  );
  expect(
    project
      .getPreEmitDiagnostics()
      .map((diagnostic) => diagnostic.getMessageText()),
  ).toEqual([]);
});
