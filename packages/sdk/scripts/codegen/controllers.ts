import {
  type CallExpression,
  Node,
  type Signature,
  type SourceFile,
  type Type,
  TypeFormatFlags,
} from "ts-morph";
import type { CommandInfo } from "./commands";
import type { EventInfo } from "./events";
import { extractDocs } from "./utils";

/** Extract inferred contracts from explicit controller values, without constructing services. */
export function extractControllers(source: SourceFile): {
  commands: CommandInfo[];
  events: EventInfo[];
} {
  const commands: CommandInfo[] = [];
  const events: EventInfo[] = [];
  source.forEachDescendant((node) => {
    if (
      !Node.isCallExpression(node) ||
      node.getExpression().getText() !== "defineController"
    )
      return;
    const [name, definition] = node.getArguments();
    if (
      !name ||
      !Node.isStringLiteral(name) ||
      !definition ||
      !Node.isObjectLiteralExpression(definition)
    )
      throw new Error(
        `${source.getBaseName()}: defineController requires a literal namespace and definition`,
      );
    const namespace = name.getLiteralText();
    const contract = node.getType();
    const commandMap = contract
      .getProperty("commands")
      ?.getTypeAtLocation(node);
    for (const property of commandMap?.getProperties() ?? []) {
      const command = property.getName();
      const descriptor = property.getTypeAtLocation(node);
      const commandContract: Type | undefined = descriptor
        .getProperty("contract")
        ?.getTypeAtLocation(node)
        .getNonNullableType();
      if (!commandContract)
        throw new Error(
          `${namespace}/${command}: command requires a typed contract`,
        );
      const args: Type | undefined = commandContract
        .getProperty("input")
        ?.getTypeAtLocation(node);
      if (
        !args ||
        (!args.isObject() && !args.isIntersection()) ||
        args.isUnion() ||
        args.isArray() ||
        args.getNumberIndexType() ||
        args.getCallSignatures().length ||
        (args.getStringIndexType() && !args.getStringIndexType()!.isNever())
      )
        throw new Error(
          `${namespace}/${command}: client arguments require an object with declared fields`,
        );
      const modeType = descriptor.getProperty("mode")?.getTypeAtLocation(node);
      const mode =
        modeType?.getLiteralValue() === "operation" ? "operation" : "result";
      const result: Type | undefined = commandContract
        .getProperty("success")
        ?.getTypeAtLocation(node);
      if (!result)
        throw new Error(
          `${namespace}/${command}: command requires a typed success value`,
        );
      commands.push({
        namespace,
        command,
        mode,
        argsType: args.getProperties().length
          ? publicType(args, node)
          : "Record<string, never>",
        returnType: publicType(result, node),
        fields: args.getProperties().map((field) => ({
          name: field.getName(),
          optional: field.isOptional(),
        })),
        docs: property.getDeclarations().flatMap(extractDocs),
      });
    }
    const eventMap = contract.getProperty("events")?.getTypeAtLocation(node);
    for (const property of eventMap?.getProperties() ?? []) {
      const sourceType = property.getTypeAtLocation(node);
      const emit: Signature | undefined = sourceType
        .getProperty("emit")
        ?.getTypeAtLocation(node)
        .getCallSignatures()[0];
      const payload: Type | undefined =
        sourceType
          .getProperty("contract")
          ?.getTypeAtLocation(node)
          .getNonNullableType()
          .getProperty("payload")
          ?.getTypeAtLocation(node) ??
        emit?.getParameters()[0]?.getTypeAtLocation(node);
      if (!payload)
        throw new Error(
          `${namespace}/${property.getName()}: event requires a typed source`,
        );
      events.push({
        namespace,
        eventName: property.getName(),
        payloadType: publicType(payload, node),
        docs: property.getDeclarations().flatMap(extractDocs),
      });
    }
  });
  return { commands, events };
}

function publicType(type: Type, location: CallExpression): string {
  // Preserve inferred shapes for the shared public-type import rewriting.
  return type
    .getText(
      location,
      TypeFormatFlags.NoTruncation | TypeFormatFlags.InTypeAlias,
    )
    .replace(/import\("[^"]+"\)\./g, "");
}
