// Copied into the clean installation directory by package.mjs.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateTestsWithOllama } from "@zof-ai/testgen";

const root = resolve("model-fixture");
await mkdir(root);
const input = {
  language: "typescript",
  source: "export function increment(x:number){return x+1;}",
  functions: ["increment"],
  module: "../fixture.ts",
};
const content =
  "import test from 'node:test'; import assert from 'node:assert/strict'; import {increment} from '../fixture.ts'; test('increments',()=>assert.equal(increment(1),2));";
let requests = 0;
let suppliedContent = content;
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    const data = JSON.parse(body);
    assert.equal(request.url, "/api/generate");
    assert.equal(data.stream, false);
    assert.equal(data.format.properties.files.items.properties.content.maxLength, undefined);
    requests++;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        model: "synthetic:local",
        done: true,
        response: JSON.stringify({
          files: [{ path: "generated/zof-model-regression.test.ts", content: suppliedContent }],
          suggestions: [],
        }),
      }),
    );
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const options = {
    allowLocalModel: true,
    model: "synthetic:local",
    port: server.address().port,
    timeoutMs: 2000,
  };
  const result = await generateTestsWithOllama(input, options);
  assert.equal(result.syntax.status, "validated");
  assert.equal(requests, 1);
  await writeFile(resolve(root, "fixture.ts"), input.source);
  await writeFile(
    resolve(root, "config.json"),
    JSON.stringify({
      language: input.language,
      sourcePath: "fixture.ts",
      functions: input.functions,
      module: input.module,
      ollama: { model: options.model, port: options.port, timeoutMs: 2000 },
    }),
  );
  const cli = resolve("node_modules/@zof-ai/testgen/dist/cli.js");
  const run = (args) =>
    new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [cli, "config.json", "--root", root, "--json", ...args],
        { stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH } },
      );
      let stdout = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.resume();
      child.on("exit", (status) => resolve({ status, stdout }));
    });
  assert.equal((await run([])).status, 2);
  assert.equal(requests, 1);
  const accepted = await run(["--allow-local-model"]);
  assert.equal(accepted.status, 0);
  assert.equal(JSON.parse(accepted.stdout).written, false);
  assert.equal(requests, 2);
  suppliedContent = "import {increment} from '../fixture.ts'; describe('bad framework',()=>it('case',()=>expect(increment(1)).toBe(2)));";
  await assert.rejects(generateTestsWithOllama(input, options), (error) => error.code === "MODEL_CANDIDATE_FRAMEWORK_INVALID");
  assert.equal(requests, 3);
  console.log(
    JSON.stringify({
      status: "passed",
      checks: 3,
      protocolFixtureOnly: true,
      liveModel: "NOT_RUN",
    }),
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
