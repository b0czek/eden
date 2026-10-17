import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** Eden's explicit factories are not covered by Context-service diagnostics. */
export function checkEffectBoundaries(program) {
  const checker = program.getTypeChecker();
  const diagnostics = [];
  const files = program
    .getRootFileNames()
    .map((name) => program.getSourceFile(name))
    .filter(Boolean);
  const apiSymbols = new Map();
  for (const moduleName of ["effect/Effect", "effect/ManagedRuntime"]) {
    const resolved = ts.resolveModuleName(
      moduleName,
      files[0]?.fileName ?? "",
      program.getCompilerOptions(),
      ts.sys,
    ).resolvedModule;
    const source = resolved && program.getSourceFile(resolved.resolvedFileName);
    const symbol = source && checker.getSymbolAtLocation(source);
    for (const member of symbol ? checker.getExportsOfModule(symbol) : []) {
      if (
        moduleName === "effect/Effect" &&
        /^run(?:Promise|Sync|Fork|Callback)/.test(member.name)
      )
        apiSymbols.set(member, "domain-interpreter");
      if (moduleName === "effect/Effect" && member.name === "forkDetach")
        apiSymbols.set(member, "unowned-fiber");
      if (moduleName === "effect/ManagedRuntime" && member.name === "make")
        apiSymbols.set(member, "domain-interpreter");
    }
  }

  function effectChannel(type, channel, at) {
    const marker = checker.getPropertyOfType(type, "~effect/Effect");
    if (!marker) return undefined;
    const variance = checker.getTypeOfSymbolAtLocation(marker, at);
    const field = checker.getPropertyOfType(variance, channel);
    if (!field) return undefined;
    const signature = checker.getSignaturesOfType(
      checker.getTypeOfSymbolAtLocation(field, at),
      ts.SignatureKind.Call,
    )[0];
    return signature && checker.getReturnTypeOfSignature(signature);
  }

  function variants(type) {
    return type.isUnion() ? type.types : [type];
  }

  for (const source of files) {
    if (
      source.isDeclarationFile ||
      /\.(?:test|spec)\.ts$/.test(source.fileName)
    )
      continue;
    const lines = source.text.split(/\r?\n/);
    const exceptions = new Map();
    lines.forEach((line, index) => {
      const match = line.match(
        /^\s*\/\/ @eden-effect-next-line ([\w-]+) -- (\S.*)$/,
      );
      if (match) exceptions.set(index + 1, { rule: match[1], used: false });
      else if (/^\s*\/\/\s*@eden-effect-next-line\b/.test(line))
        diagnostics.push({
          file: source.fileName,
          line: index + 1,
          rule: "invalid-exception",
          message:
            "Use // @eden-effect-next-line <rule> -- <adapter or ownership reason>.",
        });
    });
    const report = (node, rule, message) => {
      const { line } = source.getLineAndCharacterOfPosition(
        node.getStart(source),
      );
      const exception = exceptions.get(line);
      if (exception?.rule === rule) {
        exception.used = true;
        return;
      }
      diagnostics.push({
        file: source.fileName,
        line: line + 1,
        rule,
        message,
      });
    };

    function inputRequirements(type, at, found = new Set(), seen = new Set()) {
      if (seen.has(type)) return found;
      seen.add(type);
      for (const variant of variants(type)) {
        const requirement = effectChannel(variant, "_R", at);
        for (const r of requirement ? variants(requirement) : [])
          if (r.flags & ts.TypeFlags.TypeParameter) found.add(r);
        for (const signature of checker.getSignaturesOfType(
          variant,
          ts.SignatureKind.Call,
        ))
          inputRequirements(
            checker.getReturnTypeOfSignature(signature),
            at,
            found,
            seen,
          );
      }
      return found;
    }

    function checkMethodResult(type, at, name, provided = new Set()) {
      for (const variant of variants(type)) {
        const requirement = effectChannel(variant, "_R", at);
        if (requirement) {
          // Generic combinators can preserve their caller's R without introducing a dependency.
          const leaked = variants(requirement).filter(
            (r) => !(r.flags & ts.TypeFlags.Never) && !provided.has(r),
          );
          if (leaked.length)
            report(
              at,
              "unresolved-requirements",
              `${name} requires ${leaked.map((r) => checker.typeToString(r)).join(" | ")}; provide method dependencies during acquisition.`,
            );
        } else {
          const promised = checker.getPromisedTypeOfPromise(variant);
          if (promised) checkMethodResult(promised, at, name, provided);
        }
      }
    }

    function checkFactory(type, at, name) {
      for (const variant of variants(type)) {
        const success = effectChannel(variant, "_A", at);
        const promised = checker.getPromisedTypeOfPromise(variant);
        if (success || promised) {
          checkFactory(success ?? promised, at, name);
          continue;
        }
        for (const member of checker.getPropertiesOfType(variant)) {
          const declaration =
            member.valueDeclaration ?? member.declarations?.[0] ?? at;
          const location =
            declaration.getSourceFile() === source ? declaration : at;
          const memberType = checker.getTypeOfSymbolAtLocation(member, at);
          const label = `${name}.${member.name}`;
          checkMethodResult(memberType, location, label);
          for (const signature of checker.getSignaturesOfType(
            memberType,
            ts.SignatureKind.Call,
          )) {
            const provided = new Set();
            for (const parameter of signature.parameters)
              inputRequirements(
                checker.getTypeOfSymbolAtLocation(parameter, location),
                location,
                provided,
              );
            checkMethodResult(
              checker.getReturnTypeOfSignature(signature),
              location,
              label,
              provided,
            );
          }
        }
      }
    }

    const moduleSymbol = checker.getSymbolAtLocation(source);
    for (const exported of moduleSymbol
      ? checker.getExportsOfModule(moduleSymbol)
      : []) {
      if (!/^create[A-Z]/.test(exported.name)) continue;
      const target =
        exported.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(exported)
          : exported;
      const at = target.valueDeclaration;
      if (!at || at.getSourceFile() !== source) continue;
      for (const signature of checker.getSignaturesOfType(
        checker.getTypeOfSymbolAtLocation(target, at),
        ts.SignatureKind.Call,
      ))
        checkFactory(
          checker.getReturnTypeOfSignature(signature),
          at,
          exported.name,
        );
    }

    function visit(node) {
      // Check references, including aliased imports and assigning an interpreter to a variable.
      if (ts.isIdentifier(node) && !ts.isImportSpecifier(node.parent)) {
        let symbol = checker.getSymbolAtLocation(node);
        if (symbol?.flags & ts.SymbolFlags.Alias)
          symbol = checker.getAliasedSymbol(symbol);
        const rule = apiSymbols.get(symbol);
        if (rule) {
          report(
            node,
            rule,
            rule === "unowned-fiber"
              ? "Detached fibers have no scope owner; use forkScoped, forkIn, or a scoped FiberSet."
              : "Domain work must compose Effects; interpret only at an explicit native or lifecycle boundary.",
          );
        }
      }
      if (
        ts.isElementAccessExpression(node) &&
        node.argumentExpression &&
        ts.isStringLiteralLike(node.argumentExpression)
      ) {
        const symbol = checker.getPropertyOfType(
          checker.getTypeAtLocation(node.expression),
          node.argumentExpression.text,
        );
        const rule = apiSymbols.get(symbol);
        if (rule)
          report(
            node,
            rule,
            "Use Effect composition and scoped fiber ownership; native interpreter adapters need an explicit exception.",
          );
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    for (const [line, exception] of exceptions) {
      if (!exception.used)
        diagnostics.push({
          file: source.fileName,
          line,
          rule: "unused-exception",
          message: `The ${exception.rule} exception does not suppress a diagnostic on the next line.`,
        });
    }
  }
  return diagnostics;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const project = path.resolve(process.argv[2] ?? "tsconfig.json");
  const config = ts.readConfigFile(project, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    config.config ?? {},
    ts.sys,
    path.dirname(project),
  );
  const errors = [...(config.error ? [config.error] : []), ...parsed.errors];
  if (errors.length) {
    console.error(
      ts.formatDiagnosticsWithColorAndContext(errors, {
        getCurrentDirectory: ts.sys.getCurrentDirectory,
        getCanonicalFileName: (name) => name,
        getNewLine: () => "\n",
      }),
    );
    process.exitCode = 1;
  } else {
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    const diagnostics = checkEffectBoundaries(program);
    for (const diagnostic of diagnostics)
      console.error(
        `${path.relative(process.cwd(), diagnostic.file)}:${diagnostic.line}: eden/${diagnostic.rule}: ${diagnostic.message}`,
      );
    console.log(`Eden Effect boundaries: ${diagnostics.length} errors.`);
    process.exitCode = diagnostics.length ? 1 : 0;
  }
}
