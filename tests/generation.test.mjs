import test from "node:test";
import assert from "node:assert/strict";
import {
  generateTests,
  writeCandidates,
  readSource,
  localDeterministicAdapter,
} from "../dist/index.js";
import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const tsInput = {
  language: "typescript",
  source:
    "export function clamp(value: number): number { if (value < 0) return 0; return value; }",
  functions: ["clamp"],
  module: "../fixture.ts",
  reproductions: [{ function: "clamp", args: [10], expected: 5 }],
};
const pyInput = {
  language: "python",
  source:
    "def clamp(value):\n    if value < 0:\n        return 0\n    return value\n",
  functions: ["clamp"],
  module: "fixture",
  reproductions: [{ function: "clamp", args: [10], expected: 5 }],
};
test("unit: deterministic candidates preserve oracle and suggest branches/boundaries", () => {
  const a = generateTests(tsInput),
    b = localDeterministicAdapter.generate(tsInput);
  assert.deepEqual(a, b);
  assert.equal(a.syntax.status, "validated");
  assert.ok(a.suggestions.some((s) => s.kind === "branch"));
  assert.ok(a.suggestions.some((s) => s.kind === "boundary"));
  assert.match(a.files[0].content, /10/);
  assert.match(a.files[0].content, /deepStrictEqual/);
});
test("unit: branch hints remove only matching hints, no-oracle tests stay pending", () => {
  const r = generateTests({
    ...tsInput,
    coveredBranches: ["clamp:1"],
    reproductions: [],
  });
  assert.equal(r.suggestions.filter((s) => s.kind === "branch").length, 0);
  assert.match(r.files[0].content, /test.todo/);
  assert.match(
    generateTests({ ...pyInput, reproductions: [] }).files[0].content,
    /unittest.skip/,
  );
});
test("integration: Python source and candidates are parsed without executing source", () => {
  const r = generateTests({
    ...pyInput,
    source: 'raise RuntimeError("must not run")\n' + pyInput.source,
  });
  assert.equal(r.syntax.status, "validated");
  assert.match(r.files[0].content, /assertEqual/);
});
test("security: malformed/unsupported source, paths and reproduction functions reject", () => {
  for (const input of [
    { ...tsInput, source: "export function (" },
    { ...tsInput, module: "../../secret.ts" },
    { ...tsInput, functions: ["x;evil()"] },
    {
      ...tsInput,
      reproductions: [{ function: "missing", args: [], expected: null }],
    },
    { ...pyInput, module: "os; system(1)" },
    { ...pyInput, source: "def foo(:" },
    { ...tsInput, source: "x".repeat(4194305) },
  ])
    assert.throws(() => generateTests(input), /Input rejected/);
});
test("security: hostile argument strings remain inert syntax-valid literals", () => {
  const text = '\"); process.exit(99); // <script>secret</script>\n';
  for (const input of [tsInput, pyInput]) {
    const result = generateTests({
      ...input,
      reproductions: [{ function: "clamp", args: [text], expected: text }],
    });
    assert.equal(result.syntax.status, "validated");
  }
});
test("integration: default dry-run, exclusive create and symlink protection", async () => {
  const root = await mkdtemp(join(tmpdir(), "testgen-write-"));
  try {
    const result = generateTests(tsInput);
    await writeCandidates(root, result);
    await assert.rejects(readFile(join(root, result.files[0].path)));
    await writeCandidates(root, result, { dryRun: false });
    const before = await readFile(join(root, result.files[0].path), "utf8");
    await assert.rejects(writeCandidates(root, result, { dryRun: false }));
    assert.equal(
      await readFile(join(root, result.files[0].path), "utf8"),
      before,
    );
    await assert.rejects(readSource(root, "../secret"));
    const other = await mkdtemp(join(tmpdir(), "testgen-link-"));
    try {
      await symlink(root, join(other, "generated"));
      await assert.rejects(writeCandidates(other, result, { dryRun: false }));
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("e2e: accepted TypeScript candidate catches bug then passes correction", async () => {
  const root = await mkdtemp(join(tmpdir(), "testgen-ts-"));
  try {
    await writeFile(join(root, "package.json"), ' {"type":"module"}');
    await writeFile(join(root, "fixture.ts"), tsInput.source);
    await writeCandidates(root, generateTests(tsInput), { dryRun: false });
    const run = () =>
      spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "--test",
          "generated/zof-regression.test.ts",
        ],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 10000,
          env: { PATH: process.env.PATH },
        },
      );
    assert.equal(run().status, 1);
    await writeFile(
      join(root, "fixture.ts"),
      "export function clamp(value: number): number { return Math.min(5, Math.max(0, value)); }",
    );
    assert.equal(run().status, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("e2e: accepted Python candidate catches bug then passes correction", async () => {
  const root = await mkdtemp(join(tmpdir(), "testgen-py-"));
  try {
    await writeFile(join(root, "fixture.py"), pyInput.source);
    await writeCandidates(root, generateTests(pyInput), { dryRun: false });
    const run = () =>
      spawnSync(
        "python3",
        ["-m", "unittest", "discover", "-s", "generated", "-p", "test_*.py"],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 10000,
          env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1" },
        },
      );
    assert.equal(run().status, 1);
    await writeFile(
      join(root, "fixture.py"),
      "def clamp(value):\n    return min(5,max(0,value))\n",
    );
    assert.equal(run().status, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("e2e: CLI dry-run JSON then explicit write never overwrites", async () => {
  const root = await mkdtemp(join(tmpdir(), "testgen-cli-"));
  try {
    await writeFile(join(root, "fixture.ts"), tsInput.source);
    await writeFile(
      join(root, "config.json"),
      JSON.stringify({
        ...tsInput,
        source: undefined,
        sourcePath: "fixture.ts",
      }),
    );
    const run = (extra = []) =>
      spawnSync(
        process.execPath,
        ["dist/cli.js", "config.json", "--root", root, "--json", ...extra],
        { encoding: "utf8" },
      );
    assert.equal(JSON.parse(run().stdout).written, false);
    assert.equal(run(["--write"]).status, 0);
    assert.equal(run(["--write"]).status, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
