import ts from "typescript";
import { redact, safeWriteFiles } from "@zof-ai/evidence-spec";
import { spawnSync } from "node:child_process";
import { posix } from "node:path";
import {
  fail,
  guard,
  relativePath,
  readBounded,
  MAX_INPUT_BYTES,
} from "./common.js";
export { SafeInputError } from "./common.js";
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export interface Reproduction {
  function: string;
  args: JsonValue[];
  expected: JsonValue;
}
export interface GenerationInput {
  language: "typescript" | "python";
  source: string;
  functions: string[];
  module: string;
  reproductions?: Reproduction[];
  coveredBranches?: string[];
}
export interface GenerationResult {
  files: Array<{ path: string; content: string }>;
  suggestions: Array<{ function: string; kind: string; message: string }>;
  warnings: string[];
  syntax: { status: "validated" | "not-run"; language: string };
}
interface FunctionInfo {
  name: string;
  parameters: number;
  branches: number[];
  startLine?: number;
  endLine?: number;
}
const identifier = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(v);
const PYTHON_ANALYZE = `import ast,json,sys\ntry:\n t=ast.parse(sys.stdin.read())\n out=[]\n for n in t.body:\n  if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)):\n   out.append({'name':n.name,'parameters':len(n.args.posonlyargs)+len(n.args.args),'startLine':n.lineno,'endLine':n.end_lineno,'branches':[x.lineno for x in ast.walk(n) if isinstance(x,(ast.If,ast.IfExp,ast.For,ast.While,ast.Match))],'async':(isinstance(n,ast.AsyncFunctionDef) or any(isinstance(x,(ast.Yield,ast.YieldFrom)) for x in ast.walk(n)))})\n print(json.dumps(out))\nexcept (SyntaxError,ValueError,RecursionError):\n sys.exit(2)\n`;
const PYTHON_VALIDATE =
  "import ast,sys\ntry:\n ast.parse(sys.stdin.read())\nexcept (SyntaxError,ValueError,RecursionError):\n sys.exit(2)\n";
function python(source: string, script: string): string {
  const result = spawnSync("python3", ["-I", "-S", "-c", script], {
    input: source,
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 65536,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
  });
  if (result.error) fail("PYTHON_PARSER_UNAVAILABLE");
  if (result.status !== 0) fail("PYTHON_SYNTAX_INVALID");
  return result.stdout;
}
function typescriptSyntax(source: string): ts.SourceFile {
  const output = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  });
  if (
    output.diagnostics?.some((d) => d.category === ts.DiagnosticCategory.Error)
  )
    fail("TYPESCRIPT_SYNTAX_INVALID");
  const ast = ts.createSourceFile(
    "input.ts",
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const diagnostics = (
    ast as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (diagnostics?.length) fail("TYPESCRIPT_SYNTAX_INVALID");
  return ast;
}
function analyze(input: GenerationInput): FunctionInfo[] {
  if (input.language === "python") {
    const data = JSON.parse(python(input.source, PYTHON_ANALYZE)) as Array<
      FunctionInfo & { async: boolean }
    >;
    if (data.some((f) => input.functions.includes(f.name) && f.async))
      fail("ASYNC_FUNCTION_UNSUPPORTED");
    return data;
  }
  const ast = typescriptSyntax(input.source);
  const found: FunctionInfo[] = [];
  for (const statement of ast.statements) {
    if (
      !ts.isFunctionDeclaration(statement) ||
      !statement.name ||
      !statement.body
    )
      continue;
    if (
      !statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    )
      continue;
    if (
      statement.modifiers.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ||
      statement.asteriskToken
    )
      continue;
    const branches: number[] = [];
    let nodes = 0;
    const visit = (node: ts.Node, depth = 0): void => {
      if (++nodes > 100000 || depth > 100) fail("SOURCE_COMPLEXITY");
      if (
        ts.isIfStatement(node) ||
        ts.isConditionalExpression(node) ||
        ts.isCaseClause(node) ||
        ts.isForStatement(node) ||
        ts.isWhileStatement(node)
      )
        branches.push(
          ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
        );
      ts.forEachChild(node, (n) => visit(n, depth + 1));
    };
    visit(statement);
    found.push({
      name: statement.name.text,
      parameters: statement.parameters.length,
      branches,
    });
  }
  return found;
}
function moduleValid(input: GenerationInput): void {
  if (typeof input.module !== "string" || input.module.length > 200)
    fail("MODULE_INVALID");
  if (input.language === "python") {
    if (!/^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*$/.test(input.module))
      fail("MODULE_INVALID");
  } else {
    if (
      !/^\.{1,2}\/[\w./-]+\.(?:ts|js|mts|mjs)$/.test(input.module) ||
      input.module.includes("\\")
    )
      fail("MODULE_INVALID");
    const path = posix.normalize("generated/" + input.module);
    relativePath(path);
  }
}

/** Check the supported test framework without importing or running a candidate.
 * This is a structural compatibility check, not a sandbox or correctness proof.
 */
export function validateCandidateFramework(source: string, input: GenerationInput): void {
  if (input.language === "python") {
    const result = python(JSON.stringify({ source, module: input.module }), `import ast,json,sys
try:
 d=json.load(sys.stdin); t=ast.parse(d["source"])
 frameworks={n.asname or n.name for s in t.body if isinstance(s,ast.Import) for n in s.names if n.name=="unittest"}
 modules={s.module for s in t.body if isinstance(s,ast.ImportFrom)}
 cases=[n for n in t.body if isinstance(n,ast.ClassDef) and any(isinstance(b,ast.Attribute) and isinstance(b.value,ast.Name) and b.value.id in frameworks and b.attr=="TestCase" for b in n.bases)]
 tests=[n for c in cases for n in c.body if isinstance(n,ast.FunctionDef) and n.name.startswith("test_")]
 assertions=[n for t in tests for n in ast.walk(t) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and isinstance(n.func.value,ast.Name) and n.func.value.id=="self" and n.func.attr.startswith("assert")]
 print(json.dumps(bool(frameworks and d["module"] in modules and tests and assertions)))
except (SyntaxError,ValueError,RecursionError,KeyError):
 sys.exit(2)
`);
    if (result.trim() !== "true") fail("MODEL_CANDIDATE_FRAMEWORK_INVALID");
    return;
  }
  const ast = typescriptSyntax(source);
  const tests = new Set<string>(), assertions = new Set<string>();
  let targetImported = false;
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (module === "node:test") {
      if (clause.name) tests.add(clause.name.text);
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings))
        for (const element of clause.namedBindings.elements)
          if (!element.isTypeOnly && (element.propertyName?.text ?? element.name.text) === "test") tests.add(element.name.text);
    }
    if (module === "node:assert/strict") {
      if (clause.name) assertions.add(clause.name.text);
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) assertions.add(clause.namedBindings.name.text);
    }
    if (module === input.module && clause.namedBindings && ts.isNamedImports(clause.namedBindings))
      targetImported = clause.namedBindings.elements.some(e => !e.isTypeOnly && input.functions.includes(e.propertyName?.text ?? e.name.text));
  }
  let testCall = false, assertionCall = false, nodes = 0;
  const visit = (node: ts.Node, depth = 0): void => {
    if (++nodes > 100000 || depth > 100) fail("MODEL_CANDIDATE_FRAMEWORK_INVALID");
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && tests.has(node.expression.text)) testCall = true;
      if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && assertions.has(node.expression.expression.text)) assertionCall = true;
    }
    ts.forEachChild(node, child => visit(child, depth + 1));
  };
  visit(ast);
  if (!targetImported || !testCall || !assertionCall) fail("MODEL_CANDIDATE_FRAMEWORK_INVALID");
}

/** Reject instead of modifying any supplied regression oracle or metadata. */
export function assertNoSensitive(value: unknown, code = "GENERATION_INPUT_SENSITIVE"): void {
  let changed: boolean;
  try {
    changed = JSON.stringify(redact(value)) !== JSON.stringify(value);
  } catch {
    fail("GENERATION_INPUT_UNSUPPORTED");
  }
  if (changed) fail(code);
}

export function generateTests(input: GenerationInput): GenerationResult {
  guard(input);
  if (!input || !["typescript", "python"].includes(input.language))
    fail("LANGUAGE_UNSUPPORTED");
  if (
    typeof input.source !== "string" ||
    Buffer.byteLength(input.source) > MAX_INPUT_BYTES
  )
    fail("INPUT_SIZE");
  if (
    !Array.isArray(input.functions) ||
    input.functions.length < 1 ||
    input.functions.length > 100 ||
    input.functions.some((n) => !identifier(n)) ||
    new Set(input.functions).size !== input.functions.length
  )
    fail("FUNCTIONS_INVALID");
  moduleValid(input);
  assertNoSensitive({
    functions: input.functions,
    module: input.module,
    reproductions: input.reproductions ?? [],
    coveredBranches: input.coveredBranches ?? [],
  });
  if (
    input.coveredBranches !== undefined &&
    (!Array.isArray(input.coveredBranches) ||
      input.coveredBranches.length > 10000 ||
      input.coveredBranches.some(
        (x) => typeof x !== "string" || x.length > 128,
      ))
  )
    fail("COVERAGE_HINT_INVALID");
  if (
    input.reproductions !== undefined &&
    (!Array.isArray(input.reproductions) || input.reproductions.length > 1000)
  )
    fail("REPRODUCTIONS_INVALID");
  const info = analyze(input),
    reproductions = input.reproductions ?? [];
  for (const name of input.functions)
    if (!info.some((f) => f.name === name))
      fail("FUNCTION_UNSUPPORTED_OR_MISSING");
  for (const r of reproductions) {
    if (
      !r ||
      !input.functions.includes(r.function) ||
      !Array.isArray(r.args) ||
      r.args.length > 100 ||
      !Object.hasOwn(r, "expected")
    )
      fail("REPRODUCTION_INVALID");
  }
  const suggestions: GenerationResult["suggestions"] = [];
  for (const name of input.functions) {
    const f = info.find((f) => f.name === name)!;
    for (const line of f.branches)
      if (!input.coveredBranches?.includes(name + ":" + line))
        suggestions.push({
          function: name,
          kind: "branch",
          message: `Review both outcomes of branch ${name}:${line}; no covered-branch hint was supplied for this location.`,
        });
    suggestions.push(
      {
        function: name,
        kind: "boundary",
        message:
          "Review zero, negative values, empty collections, and values at documented limits; derive expected results from the intended contract.",
      },
      {
        function: name,
        kind: "invalid-input",
        message:
          "Review null, missing arguments, wrong types and malformed values when allowed by the public contract.",
      },
    );
  }
  let content: string, path: string;
  if (input.language === "typescript") {
    path = "generated/zof-regression.test.ts";
    const names = [...new Set(reproductions.map((r) => r.function))];
    content =
      "// Review before execution. Expected values come from supplied bug reproductions.\nimport test from 'node:test';\nimport assert from 'node:assert/strict';\n" +
      (names.length
        ? `import { ${names.map((name, index) => name + " as __zof_fn_" + index).join(", ")} } from ${JSON.stringify(input.module)};\n`
        : "") +
      "\n";
    for (const [i, r] of reproductions.entries())
      content += `test(${JSON.stringify("regression " + r.function + " " + (i + 1))}, () => {\n  assert.deepStrictEqual(${"__zof_fn_" + names.indexOf(r.function)}(...(JSON.parse(${JSON.stringify(JSON.stringify(r.args))}) as Parameters<typeof ${"__zof_fn_" + names.indexOf(r.function)}>)), JSON.parse(${JSON.stringify(JSON.stringify(r.expected))}));\n});\n`;
    for (const name of input.functions)
      if (!reproductions.some((r) => r.function === name))
        content += `test.todo(${JSON.stringify("Add reviewed expected behavior for " + name)});\n`;
    typescriptSyntax(content);
  } else {
    const names = [...new Set(reproductions.map((r) => r.function))];
    path = "generated/test_zof_regression.py";
    content =
      "# Review before execution. Expected values come from supplied bug reproductions.\nimport json\nimport unittest\n" +
      (reproductions.length
        ? `from ${input.module} import ${names.map((name, index) => name + " as _zof_fn_" + index).join(", ")}\n`
        : "") +
      "\nclass RegressionCandidates(unittest.TestCase):\n";
    for (const [i, r] of reproductions.entries())
      content += `    def test_regression_${i + 1}(self):\n        args = json.loads(${JSON.stringify(JSON.stringify(r.args))})\n        expected = json.loads(${JSON.stringify(JSON.stringify(r.expected))})\n        self.assertEqual(${"_zof_fn_" + names.indexOf(r.function)}(*args), expected)\n\n`;
    for (const name of input.functions)
      if (!reproductions.some((r) => r.function === name))
        content += `    @unittest.skip('Supply a reviewed expected behavior before execution')\n    def test_candidate_${name}(self):\n        pass\n\n`;
    content += "if __name__ == '__main__':\n    unittest.main()\n";
    python(content, PYTHON_VALIDATE);
  }
  return {
    files: [{ path, content }],
    suggestions,
    warnings: [
      "Candidates are syntax-validated, not executed or verified. Review imports, inputs and expected behavior before accepting.",
      "Branch hints are caller supplied, not measured coverage. Boundary suggestions have no asserted oracle.",
      "The local deterministic adapter uses supplied reproduction oracles and makes no network requests. Ollama generation requires a separate explicit opt-in.",
    ],
    syntax: { status: "validated", language: input.language },
  };
}
export const localDeterministicAdapter = {
  id: "local-deterministic",
  generate: generateTests,
} as const;
export const readSource = (root: string, path: string): Promise<string> =>
  readBounded(root, path);

// Internal helpers: the package entry point intentionally does not export them.
export function selectFunctionSource(input: GenerationInput): string {
  if (input.language === "typescript") {
    const ast = typescriptSyntax(input.source);
    return ast.statements
      .filter(
        (node): node is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(node) &&
          Boolean(node.name && input.functions.includes(node.name.text)),
      )
      .map((node) => node.getText(ast))
      .join("\n\n");
  }
  // Match Python's universal-newline line numbering, including lone CR.
  const lines = input.source.split(/\r\n|\r|\n/);
  return analyze(input)
    .filter((info) => input.functions.includes(info.name))
    .map((info) => {
      if (!Number.isInteger(info.startLine) || !Number.isInteger(info.endLine))
        fail("PYTHON_PARSER_INVALID");
      return lines.slice(info.startLine! - 1, info.endLine!).join("\n");
    })
    .join("\n\n");
}

export function validateCandidateSyntax(
  content: string,
  language: GenerationInput["language"],
): void {
  try {
    if (language === "python") {
      python(content, PYTHON_VALIDATE);
      return;
    }
    typescriptSyntax(content);
    const emitted = ts.transpileModule(content, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        verbatimModuleSyntax: true,
      },
    }).outputText;
    const checked = spawnSync(
      process.execPath,
      ["--check", "--input-type=module"],
      {
        input: emitted,
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 65536,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      },
    );
    if (checked.error || checked.status !== 0)
      fail("MODEL_CANDIDATE_SYNTAX_INVALID");
  } catch {
    fail("MODEL_CANDIDATE_SYNTAX_INVALID");
  }
}
export async function writeCandidates(
  root: string,
  result: GenerationResult,
  options: { dryRun?: boolean } = {},
): Promise<string[]> {
  guard(result);
  // This public writer is also a boundary for caller-created candidates.
  assertNoSensitive(result, "GENERATION_OUTPUT_SENSITIVE");
  if (!Array.isArray(result.files) || result.files.length > 64)
    fail("FILES_INVALID");
  for (const file of result.files) {
    relativePath(file.path);
    if (
      !file.path.startsWith("generated/") ||
      typeof file.content !== "string" ||
      Buffer.byteLength(file.content) > MAX_INPUT_BYTES
    )
      fail("FILE_INVALID");
  }
  if (options.dryRun !== false || result.files.length === 0) return result.files.map((f) => f.path);
  try {
    await safeWriteFiles(root, result.files, { createParents: true });
    return result.files.map((file) => file.path);
  } catch {
    return fail("OUTPUT_EXISTS_OR_UNAVAILABLE");
  }

}
