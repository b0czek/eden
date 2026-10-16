import * as path from "node:path";
import { Project } from "ts-morph";
import { generateClientCode } from "./client";
import { generateCommandsCode, groupCommandsByNamespace } from "./commands";
import { extractControllers } from "./controllers";
import { generateEventsCode, groupEventsByNamespace } from "./events";

it("extracts schema inputs, inferred results, operations, and event payloads from controller values", () => {
  const project = new Project({
    tsConfigFilePath: path.join(__dirname, "../../tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  const fixture = project.createSourceFile(
    path.join(__dirname, "../../src/controllers/contract.fixture.ts"),
    `
    import * as v from "valibot";
    import { command, defineController } from "./controller";
    import { createEvent } from "../events/event";
    import { targetedEvent, routedEvent, type TargetedNotification, type RoutedNotification } from "./events";
    import { operationTask } from "../operations/OperationTask";
    export const example = defineController("example", {
      commands: {
        /**
         * Read the requested count.
         * @returns The resolved numeric value.
         */
        read: command({
          input: v.object({ count: v.optional(v.number(), 4) }),
          handle: ({ count }) => {
            const resolved: number = count;
            return { value: resolved + 1 };
          },
        }),
        // Internal implementation comment is not public documentation.
        /** Save the current value. */
        save: command({ mode: "operation", handle: () => operationTask(async () => "saved") }),
      },
      events: {
        changed: createEvent<{ value: number }>(),
        selected: targetedEvent(createEvent<TargetedNotification<{ selected: string }>>()),
        notice: routedEvent(createEvent<RoutedNotification<{ message: string }>>()),
      },
    });
    // @ts-expect-error the validated argument is inferred as a number
    command({ input: v.object({ count: v.number() }), handle: ({ count }: { count: string }) => count });
  `,
  );
  expect(
    project
      .getPreEmitDiagnostics()
      .map((diagnostic) => diagnostic.getMessageText()),
  ).toEqual([]);
  const contracts = extractControllers(fixture);
  const commandNamespaces = groupCommandsByNamespace(contracts.commands);
  for (const output of [
    generateCommandsCode(commandNamespaces, new Set()),
    generateClientCode(commandNamespaces),
  ]) {
    expect(output).toContain("* Read the requested count.");
    expect(output).toContain("* @returns The resolved numeric value.");
    expect(output).toContain("* Save the current value.");
    expect(output).not.toContain("Internal implementation comment");
  }
  expect(
    contracts.commands.map(({ namespace, command, fields, mode }) => ({
      namespace,
      command,
      fields,
      mode,
    })),
  ).toEqual([
    {
      namespace: "example",
      command: "read",
      fields: [{ name: "count", optional: true }],
      mode: "result",
    },
    { namespace: "example", command: "save", fields: [], mode: "operation" },
  ]);
  expect(contracts.commands[1].returnType).toBe("string");
  expect(
    contracts.events.map(({ namespace, eventName }) => ({
      namespace,
      eventName,
    })),
  ).toEqual([
    { namespace: "example", eventName: "changed" },
    { namespace: "example", eventName: "selected" },
    { namespace: "example", eventName: "notice" },
  ]);
  project.createSourceFile(
    path.join(__dirname, "../../src/controllers/events.fixture.ts"),
    generateEventsCode(groupEventsByNamespace(contracts.events), new Set()),
  );
  project.createSourceFile(
    path.join(__dirname, "../../src/controllers/consumer.fixture.ts"),
    `
    import type { ExampleEvents } from "./events.fixture";
    const change: ExampleEvents["example/changed"] = { value: 2 };
    const selected: ExampleEvents["example/selected"] = { selected: "item" };
    const notice: ExampleEvents["example/notice"] = { message: "public" };
    // @ts-expect-error broadcast audiences remain private too
    const privateNotice: ExampleEvents["example/notice"] = { message: "public", viewIds: [] };
    // @ts-expect-error routing metadata is private to the controller
    const routed: ExampleEvents["example/selected"] = { selected: "item", viewIds: [1] };
    // @ts-expect-error generated event payloads retain their numeric field
    const invalid: ExampleEvents["example/changed"] = { value: "two" };
  `,
  );
  expect(
    project
      .getPreEmitDiagnostics()
      .map((diagnostic) => diagnostic.getMessageText()),
  ).toEqual([]);
});

it("generates public success values without Effect failures or service requirements", () => {
  const project = new Project({
    tsConfigFilePath: path.join(__dirname, "../../tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  const directory = path.join(__dirname, "../../src/controllers");
  const fixture = project.createSourceFile(
    path.join(directory, "effect-contract.fixture.ts"),
    `
    import { Effect } from "effect";
    import * as v from "valibot";
    import { command, defineController, operation } from "./controller";
    import { operationTask } from "../operations/OperationTask";
    declare const load: Effect.Effect<{ value: number }, { _tag: "LoadFailed" }, { storage: true }>;
    declare const empty: Effect.Effect<undefined, { _tag: "EmptyFailed" }, { storage: true }>;
    declare const nullable: Effect.Effect<string | null | undefined, never, never>;
    export const example = defineController("example", {
      commands: {
        load: command({
          input: v.object({ count: v.optional(v.number(), 4) }),
          handle: ({ count }) => {
            const validated: number = count;
            return load;
          },
        }),
        promise: command({ handle: async () => ({ value: 2 }) }),
        plain: command({ handle: () => 2 }),
        empty: command({ handle: () => empty }),
        nullable: command({ handle: () => nullable }),
        null: command({ handle: () => null }),
        undefined: command({ handle: () => undefined }),
        save: command({
          mode: "operation",
          handle: () => operationTask(async () => ({ saved: true })),
        }),
        saveEffect: operation({
          input: v.object({ value: v.optional(v.number(), 4) }),
          prepare: ({ value }) => () => Effect.succeed({ saved: value }),
        }),
      },
    });
    // @ts-expect-error operation work must have its dependencies provided
    operation({ prepare: () => () => load });
    // @ts-expect-error preparation must finish before operation acceptance
    operation({ prepare: async () => () => Effect.succeed(1) });
  `,
  );
  const contracts = extractControllers(fixture);
  project.createSourceFile(
    path.join(directory, "commands.fixture.ts"),
    generateCommandsCode(
      groupCommandsByNamespace(contracts.commands),
      new Set(),
    ),
  );
  // Generated operation declarations resolve their public handle through index.
  project.createSourceFile(
    path.join(directory, "index.ts"),
    'export type { OperationHandle } from "@edenapp/types";',
  );
  project.createSourceFile(
    path.join(directory, "effect-consumer.fixture.ts"),
    `
    import type { ExampleCommands } from "./commands.fixture";
    type Equal<A, B> =
      (<T>() => T extends A ? 1 : 2) extends
      (<T>() => T extends B ? 1 : 2) ? true : false;
    type Assert<T extends true> = T;
    type Contracts = [
      Assert<Equal<ExampleCommands["example/load"]["response"], { value: number }>>,
      Assert<Equal<ExampleCommands["example/promise"]["response"], { value: number }>>,
      Assert<Equal<ExampleCommands["example/plain"]["response"], number>>,
      Assert<Equal<ExampleCommands["example/empty"]["response"], undefined>>,
      Assert<Equal<ExampleCommands["example/nullable"]["response"], string | null | undefined>>,
      Assert<Equal<ExampleCommands["example/null"]["response"], null>>,
      Assert<Equal<ExampleCommands["example/undefined"]["response"], undefined>>,
      Assert<Equal<ExampleCommands["example/save"]["completion"], { saved: boolean }>>,
      Assert<Equal<ExampleCommands["example/saveEffect"]["completion"], { saved: number }>>,
    ];
    const operationInput: ExampleCommands["example/saveEffect"]["args"] = {};
    const defaulted: ExampleCommands["example/load"]["args"] = {};
    // @ts-expect-error schema inputs preserve their numeric type
    const invalidInput: ExampleCommands["example/load"]["args"] = { count: "four" };
    // @ts-expect-error generated results contain the public value, not failure cases
    const invalidResult: ExampleCommands["example/load"]["response"] = { _tag: "LoadFailed" };
  `,
  );
  expect(
    project
      .getPreEmitDiagnostics()
      .map((diagnostic) => diagnostic.getMessageText()),
  ).toEqual([]);
});
