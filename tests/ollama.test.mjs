import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, access, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  generateTestsWithOllama,
  createOllamaAdapter,
  writeCandidates,
  SafeInputError,
} from "../dist/index.js";

const input = {
  language: "typescript",
  source:
    'const unrelated_private_marker = "DO_NOT_TRANSMIT";\nexport function clamp(value: number) { return Math.min(5,value); }',
  functions: ["clamp"],
  module: "../fixture.ts",
  reproductions: [{ function: "clamp", args: [10], expected: 5 }],
};
const candidate = {
  files: [
    {
      path: "generated/zof-model-regression.test.ts",
      content:
        "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {clamp} from '../fixture.ts';\ntest('upper limit',()=>assert.equal(clamp(10),5));\n",
    },
  ],
  suggestions: [
    {
      function: "clamp",
      kind: "boundary",
      message: "Review the upper limit oracle.",
    },
  ],
};
const envelope = (value = candidate, other = {}) => ({
  model: "synthetic:local",
  response: JSON.stringify(value),
  done: true,
  done_reason: "stop",
  ...other,
});
const ok = (response, value = envelope()) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
};
async function fixture(handler) {
  const requests = [];
  const server = createServer((request, response) => {
    let data = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => (data += chunk));
    request.on("end", () => {
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: JSON.parse(data),
      });
      handler(request, response, requests.at(-1));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    requests,
    port: server.address().port,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
const opts = (port) => ({
  allowLocalModel: true,
  model: "synthetic:local",
  port,
  maxTokens: 128,
  timeoutMs: 2000,
});
const safe = (code) => (error) =>
  error instanceof SafeInputError &&
  (!code || error.code === code) &&
  !error.message.includes("SECRET_SENTINEL");

test("integration: Ollama protocol sends bounded selected source and validates candidates", async () => {
  const server = await fixture((_request, response) => ok(response));
  try {
    const adapter = createOllamaAdapter(opts(server.port));
    assert.equal(server.requests.length, 0);
    const result = await adapter.generate(input);
    assert.equal(result.syntax.status, "validated");
    assert.match(result.warnings[0], /unverified/);
    assert.equal(server.requests.length, 1);
    const request = server.requests[0];
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/api/generate");
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers["accept-encoding"], "identity");
    assert.deepEqual(Object.keys(request.body).sort(), [
      "format",
      "keep_alive",
      "model",
      "options",
      "prompt",
      "stream",
      "system",
    ]);
    assert.equal(request.body.stream, false);
    assert.equal(request.body.options.num_predict, 128);
    assert.equal(request.body.options.num_ctx, 8192);
    assert.match(request.body.system, /import test from 'node:test'/);
    assert.match(request.body.system, /exact argument and expected values/);
    assert.ok(Buffer.byteLength(JSON.stringify(request.body)) <= 32768);
    const prompt = JSON.parse(request.body.prompt);
    assert.match(prompt.source, /function clamp/);
    assert.ok(!prompt.source.includes("DO_NOT_TRANSMIT"));
    assert.deepEqual(prompt.reproductions, input.reproductions);
    assert.equal(
      request.body.format.properties.files.items.properties.path.const,
      candidate.files[0].path,
    );
    assert.equal(
      request.body.format.properties.files.items.properties.content.maxLength,
      undefined,
    );
  } finally {
    await server.close();
  }
});

test("security: provider grammar hint omission preserves the application candidate byte cap", async () => {
  const oversized = structuredClone(candidate);
  oversized.files[0].content = "x".repeat(128 * 1024 + 1);
  const server = await fixture((_request, response) => ok(response, envelope(oversized)));
  try {
    await assert.rejects(generateTestsWithOllama(input, opts(server.port)), safe("MODEL_OUTPUT_SCHEMA_INVALID"));
    assert.equal(server.requests[0].body.format.properties.files.items.properties.content.maxLength, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(envelope(oversized))) < 256 * 1024);
  } finally { await server.close(); }
});

test("security: no consent or invalid options/source causes zero requests", async () => {
  const server = await fixture((_request, response) => ok(response));
  try {
    for (const options of [
      { ...opts(server.port), allowLocalModel: false },
      { model: "synthetic:local", port: server.port },
      { ...opts(server.port), model: "model:cloud" },
      { ...opts(server.port), model: "remote-model-cloud" },
      { ...opts(server.port), model: "https://SECRET_SENTINEL" },
      { ...opts(server.port), port: 80 },
      { ...opts(server.port), port: 65536 },
      { ...opts(server.port), maxTokens: -1 },
      { ...opts(server.port), maxTokens: 4097 },
      { ...opts(server.port), maxTokens: 1.5 },
      { ...opts(server.port), timeoutMs: Infinity },
      { ...opts(server.port), endpoint: "http://SECRET_SENTINEL" },
    ])
      await assert.rejects(generateTestsWithOllama(input, options), safe());
    await assert.rejects(
      generateTestsWithOllama(
        { ...input, source: "export function (" },
        opts(server.port),
      ),
      safe(),
    );
    await assert.rejects(
      generateTestsWithOllama(
        {
          ...input,
          source:
            "export function clamp(value:number) { /*" +
            "x".repeat(17000) +
            "*/ return value; }",
        },
        opts(server.port),
      ),
      safe("MODEL_SOURCE_TOO_LARGE"),
    );
    await assert.rejects(
      generateTestsWithOllama(
        {
          ...input,
          reproductions: [
            { function: "clamp", args: ["x".repeat(40000)], expected: null },
          ],
        },
        opts(server.port),
      ),
      safe("MODEL_REQUEST_TOO_LARGE"),
    );
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
  }
});

test("security: all redirects and HTTP errors are rejected without follow-up or secret echo", async () => {
  for (const status of [301, 302, 303, 307, 308, 400, 500]) {
    const server = await fixture((_request, response) => {
      response.writeHead(status, {
        location: "http://127.0.0.1:1/SECRET_SENTINEL",
        "content-type": "application/json",
      });
      response.end("SECRET_SENTINEL");
    });
    try {
      await assert.rejects(
        generateTestsWithOllama(input, opts(server.port)),
        safe(status < 400 ? "MODEL_REDIRECT_REJECTED" : "MODEL_HTTP_ERROR"),
      );
      assert.equal(server.requests.length, 1);
    } finally {
      await server.close();
    }
  }
});

test("security: response size, content encoding, invalid UTF-8 and JSON are bounded", async () => {
  const cases = [
    (response) => {
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": 262145,
      });
      response.end();
    },
    (response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("x".repeat(262145));
    },
    (response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("é".repeat(131073));
    },
    (response) => {
      response.writeHead(200, {
        "content-type": "application/json",
        "content-encoding": "gzip",
      });
      response.end("SECRET_SENTINEL");
    },
    (response) => {
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      response.end("{}\n{}");
    },
    (response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(Buffer.from([0xff, 0xfe]));
    },
    (response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{ SECRET_SENTINEL");
    },
    (response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}\n{}");
    },
  ];
  for (const respond of cases) {
    const server = await fixture((_request, response) => respond(response));
    try {
      await assert.rejects(
        generateTestsWithOllama(input, opts(server.port)),
        safe(),
      );
    } finally {
      await server.close();
    }
  }
});

test("security: deadline covers missing headers, stalled bodies and slow-drip responses", async () => {
  for (const mode of ["headers", "body", "drip"]) {
    const server = await fixture((_request, response) => {
      if (mode === "headers") return;
      response.writeHead(200, { "content-type": "application/json" });
      response.write("{");
      if (mode === "drip") {
        const timer = setInterval(() => response.write(" "), 10);
        response.on("close", () => clearInterval(timer));
      }
    });
    try {
      const start = Date.now();
      await assert.rejects(
        generateTestsWithOllama(input, {
          ...opts(server.port),
          timeoutMs: 100,
        }),
        safe("MODEL_TIMEOUT"),
      );
      assert.ok(Date.now() - start < 1500);
    } finally {
      await server.close();
    }
  }
});

test("security: truncated, incomplete and provider-error envelopes never become candidates", async () => {
  for (const value of [
    null,
    [],
    {},
    envelope(candidate, { done: false }),
    envelope(candidate, { done_reason: "length" }),
    envelope(candidate, { response: 5 }),
    envelope(candidate, { response: "SECRET_SENTINEL" }),
    envelope(candidate, { error: "SECRET_SENTINEL" }),
    envelope(candidate, { model: "wrong-model" }),
  ]) {
    const server = await fixture((_request, response) => ok(response, value));
    try {
      await assert.rejects(
        generateTestsWithOllama(input, opts(server.port)),
        safe(),
      );
    } finally {
      await server.close();
    }
  }
  const server = await fixture((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.write("{");
    response.socket.destroy();
  });
  try {
    await assert.rejects(
      generateTestsWithOllama(input, opts(server.port)),
      safe(),
    );
  } finally {
    await server.close();
  }
});

test("security: output schema, fixed paths, syntax and known secret patterns are enforced", async () => {
  const altered = (change) => {
    const value = structuredClone(candidate);
    change(value);
    return value;
  };
  const outputs = [
    { files: [], suggestions: [] },
    { ...candidate, extra: true },
    altered((v) => (v.files[0].path = "../escape.ts")),
    altered((v) => (v.files[0].path = "generated/other.ts")),
    altered((v) => (v.files[0].content = "export function (")),
    altered(
      (v) =>
        (v.files[0].content =
          "import test from 'node:test'; import {test} from '../fixture.ts';"),
    ),
    altered(
      (v) =>
        (v.files[0].content =
          "// https://example.test/?token=SECRET_SENTINEL\nexport {};"),
    ),
    altered((v) => (v.suggestions[0].function = "unselected")),
    altered((v) => (v.suggestions[0].message = "x".repeat(1025))),
  ];
  for (const [index, value] of outputs.entries()) {
    const server = await fixture((_request, response) =>
      ok(response, envelope(value)),
    );
    try {
      await assert.rejects(
        generateTestsWithOllama(input, opts(server.port)),
        safe(),
        `output case ${index}`,
      );
    } finally {
      await server.close();
    }
  }
});

test("integration: Python model candidate is syntax checked without module execution", async () => {
  const pyInput = {
    language: "python",
    source:
      "do_not_execute_this_module()\ndef clamp(value):\n    return min(5,value)\n",
    functions: ["clamp"],
    module: "fixture",
  };
  const value = {
    files: [
      {
        path: "generated/test_zof_model_regression.py",
        content: 'import unittest\nfrom fixture import clamp\nclass ModelTest(unittest.TestCase):\n    def test_clamp(self):\n        raise RuntimeError("do not execute generated source")\n        self.assertEqual(clamp(1),1)\n',
      },
    ],
    suggestions: [],
  };
  const server = await fixture((_request, response) =>
    ok(response, envelope(value)),
  );
  try {
    const result = await generateTestsWithOllama(pyInput, opts(server.port));
    assert.equal(result.syntax.status, "validated");
    assert.ok(
      !JSON.parse(server.requests[0].body.prompt).source.includes(
        "do_not_execute_this_module",
      ),
    );
  } finally {
    await server.close();
  }
  const invalid = await fixture((_request, response) =>
    ok(
      response,
      envelope({
        ...value,
        files: [{ ...value.files[0], content: "def SECRET_SENTINEL(:" }],
      }),
    ),
  );
  try {
    await assert.rejects(
      generateTestsWithOllama(pyInput, opts(invalid.port)),
      safe("MODEL_CANDIDATE_SYNTAX_INVALID"),
    );
  } finally {
    await invalid.close();
  }
});

test("security: Python CR and mixed newline source excludes unrelated declarations", async () => {
  const pythonInput = {language: "python", source: 'def clamp(value):\r    return value\rprivate_marker = "DO_NOT_TRANSMIT"\n', functions: ["clamp"], module: "fixture"};
  const value = {files: [{path: "generated/test_zof_model_regression.py", content: 'import unittest\nfrom fixture import clamp\nclass ModelTest(unittest.TestCase):\n    def test_clamp(self):\n        self.assertEqual(clamp(1),1)\n'}], suggestions: []};
  const server = await fixture((_request, response) => ok(response, envelope(value)));
  try {
    await generateTestsWithOllama(pythonInput, opts(server.port));
    const sent = JSON.parse(server.requests[0].body.prompt).source;
    assert.equal(sent, 'def clamp(value):\n    return value');
    assert.ok(!sent.includes('DO_NOT_TRANSMIT'));
  } finally { await server.close(); }
});

function cli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["dist/cli.js", ...args], {
      env: { PATH: process.env.PATH },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("exit", (status) => resolve({ status, stdout, stderr }));
  });
}
test("e2e: CLI config cannot grant consent; explicit flag produces reviewable dry-run then exclusive write", async () => {
  const root = await mkdtemp(join(tmpdir(), "ollama-cli-"));
  const server = await fixture((_request, response) => ok(response));
  try {
    await writeFile(join(root, "fixture.ts"), input.source);
    await writeFile(
      join(root, "config.json"),
      JSON.stringify({
        language: input.language,
        sourcePath: "fixture.ts",
        functions: input.functions,
        module: input.module,
        reproductions: input.reproductions,
        allowLocalModel: true,
        ollama: {
          model: "synthetic:local",
          port: server.port,
          maxTokens: 128,
          timeoutMs: 2000,
        },
      }),
    );
    assert.equal(
      (await cli(["config.json", "--root", root, "--json"])).status,
      2,
    );
    assert.equal(server.requests.length, 0);
    const result = await cli([
      "config.json",
      "--root",
      root,
      "--json",
      "--allow-local-model",
    ]);
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).written, false);
    await assert.rejects(access(join(root, candidate.files[0].path)));
    assert.equal(
      (
        await cli([
          "config.json",
          "--root",
          root,
          "--allow-local-model",
          "--write",
        ])
      ).status,
      0,
    );
    assert.equal(
      (
        await cli([
          "config.json",
          "--root",
          root,
          "--allow-local-model",
          "--write",
        ])
      ).status,
      2,
    );
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});


test("regression: unsupported Jest globals and assertion-free TypeScript candidates reject before execution", async () => {
  for (const content of [
    "import {clamp} from '../fixture.ts'; describe('clamp',()=>it('upper',()=>expect(clamp(10)).toBe(5)));",
    "import test from 'node:test'; import assert from 'node:assert/strict'; import {clamp} from '../fixture.ts'; test('empty',()=>{});",
    "import test from 'node:test'; import assert from 'node:assert/strict'; test('copied',()=>assert.equal(1,1));",
  ]) {
    const value = structuredClone(candidate); value.files[0].content = content;
    const server = await fixture((_request, response) => ok(response, envelope(value)));
    try { await assert.rejects(generateTestsWithOllama(input, opts(server.port)), safe("MODEL_CANDIDATE_FRAMEWORK_INVALID")); }
    finally { await server.close(); }
  }
});

test("regression: Python candidates need a unittest case, assertion and selected-module import", async () => {
  const pyInput = { language: "python", source: "def clamp(x):\n    return x\n", functions: ["clamp"], module: "fixture" };
  for (const content of ["raise RuntimeError('not a test')\n", "import unittest\nfrom fixture import clamp\n", "import unittest\nclass Cases(unittest.TestCase):\n    def test_case(self):\n        self.assertEqual(1,1)\n"]) {
    const value = { files: [{path:"generated/test_zof_model_regression.py",content}], suggestions: [] };
    const server = await fixture((_request, response) => ok(response, envelope(value)));
    try { await assert.rejects(generateTestsWithOllama(pyInput, opts(server.port)), safe("MODEL_CANDIDATE_FRAMEWORK_INVALID")); }
    finally { await server.close(); }
  }
});

test("integration: named node:test and namespace strict assertions are supported", async () => {
  const value = structuredClone(candidate);
  value.files[0].content = "import {test as check} from 'node:test'; import * as strict from 'node:assert/strict'; import {clamp as target} from '../fixture.ts'; check('upper',()=>strict.equal(target(10),5));";
  const server = await fixture((_request,response)=>ok(response,envelope(value)));
  try { assert.equal((await generateTestsWithOllama(input,opts(server.port))).syntax.status,"validated"); }
  finally { await server.close(); }
});
