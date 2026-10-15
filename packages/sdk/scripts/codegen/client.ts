import type { NamespaceCommands } from "./commands";
import type { NamespaceEvents } from "./events";
import { generateHeader } from "./utils";

function clientName(name: string, command: string): string {
  const normalized = name.replace(/[-/]([a-zA-Z0-9])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
  if (!/^[a-zA-Z_$][\w$]*$/.test(normalized)) {
    throw new Error(`${command}: invalid client name ${JSON.stringify(name)}`);
  }
  return normalized;
}

// Export names and property names may be reserved words; parameter names may not.
const reserved = new Set(
  "await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield".split(
    " ",
  ),
);

export function generateClientCode(
  commandNamespaces: NamespaceCommands[],
  eventNamespaces: NamespaceEvents[] = [],
): string {
  const lines = generateHeader(
    "Typed app client generated from command and event declarations",
  );
  lines.push(
    'import type { CommandArgs, CommandResult, EventData, OperationSubmission } from "@edenapp/types";',
  );
  lines.push('import { invoke } from "./invoke.js";', "");
  if (eventNamespaces.some((namespace) => namespace.events.length)) {
    lines.push(
      'import { subscribe, unsubscribe } from "./subscriptions.js";',
      "",
    );
  }
  const namespaces = new Map<
    string,
    {
      namespace: string;
      commands: NamespaceCommands["commands"];
      events: NamespaceEvents["events"];
    }
  >();
  for (const namespace of commandNamespaces) {
    namespaces.set(namespace.namespace, { ...namespace, events: [] });
  }
  for (const namespace of eventNamespaces) {
    const existing = namespaces.get(namespace.namespace);
    if (existing) existing.events = namespace.events;
    else namespaces.set(namespace.namespace, { ...namespace, commands: [] });
  }
  const exports = new Set<string>();
  for (const namespace of namespaces.values()) {
    const name = clientName(namespace.namespace, namespace.namespace);
    if (exports.has(name))
      throw new Error(
        `${namespace.namespace}: duplicate client namespace ${name}`,
      );
    exports.add(name);
    const localName = `${name}Commands`;
    lines.push(`const ${localName} = {`);
    const methods = new Set<string>();
    for (const command of namespace.commands) {
      const id = `${namespace.namespace}/${command.command}`;
      const method = clientName(command.command, id);
      if (
        namespace.events.length &&
        (method === "subscribe" || method === "unsubscribe")
      ) {
        throw new Error(
          `${id}: client method ${name}.${method} is reserved for event subscriptions`,
        );
      }
      if (methods.has(method))
        throw new Error(`${id}: duplicate client method ${name}.${method}`);
      methods.add(method);
      if (
        command.mode === "operation" &&
        command.fields.some((field) => field.name === "submission")
      ) {
        throw new Error(
          `${id}: argument submission conflicts with operation submission options`,
        );
      }
      const argsType = `CommandArgs<${JSON.stringify(id)}>`;
      const required = command.fields.filter((field) => !field.optional);
      const optional = command.fields.filter((field) => field.optional);
      const usedParameters = new Set<string>();
      const allocate = (candidate: string): string => {
        let parameter = reserved.has(candidate) ? `_${candidate}` : candidate;
        while (usedParameters.has(parameter)) parameter += "_";
        usedParameters.add(parameter);
        return parameter;
      };
      const values = required.map((field) => {
        if (!/^[a-zA-Z_$][\w$]*$/.test(field.name))
          throw new Error(
            `${id}: invalid argument field ${JSON.stringify(field.name)}`,
          );
        return { field, parameter: allocate(field.name) };
      });
      const parameters = values.map(
        ({ field, parameter }) =>
          `${parameter}: ${argsType}[${JSON.stringify(field.name)}]`,
      );
      const hasOptions = optional.length > 0 || command.mode === "operation";
      const options = allocate("options");
      if (hasOptions) {
        const parts: string[] = [];
        if (optional.length)
          parts.push(
            `Pick<${argsType}, ${optional.map((field) => JSON.stringify(field.name)).join(" | ")}>`,
          );
        if (command.mode === "operation")
          parts.push("{ submission?: OperationSubmission }");
        parameters.push(`${options}?: ${parts.join(" & ")}`);
      }
      if (command.docs.length) {
        lines.push("  /**");
        for (const doc of command.docs)
          lines.push(`   * ${doc.replace(/\n/g, "\n   * ")}`);
        lines.push("   */");
      }
      const properties = [
        ...values.map(
          ({ field, parameter }) =>
            `[${JSON.stringify(field.name)}]: ${parameter}`,
        ),
        ...optional.map(
          (field) =>
            `[${JSON.stringify(field.name)}]: ${options}?.[${JSON.stringify(field.name)}]`,
        ),
      ];
      lines.push(
        `  [${JSON.stringify(method)}]: (${parameters.join(", ")}): Promise<CommandResult<${JSON.stringify(id)}>> =>`,
      );
      lines.push(
        `    invoke(${JSON.stringify(id)}, { ${properties.join(", ")} }${command.mode === "operation" ? `, ${options}?.submission` : ""}),`,
      );
    }
    if (namespace.events.length) {
      const eventNames = namespace.events
        .map((event) => JSON.stringify(event.eventName))
        .join(" | ");
      const eventType = `EventData<\`${namespace.namespace}/\${E}\`>`;
      for (const method of ["subscribe", "unsubscribe"]) {
        lines.push(
          `  [${JSON.stringify(method)}]: <E extends ${eventNames}>(event: E, callback: (data: ${eventType}) => void): ${method === "subscribe" ? "Promise<void>" : "void"} =>`,
          `    ${method}(\`${namespace.namespace}/\${event}\`, callback),`,
        );
      }
    }
    lines.push("};", `export { ${localName} as ${name} };`, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
