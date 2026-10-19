# Optional local Ollama adapter

The adapter implements the public [Ollama generate API](https://docs.ollama.com/api/generate) with a single POST to `http://127.0.0.1:11434/api/generate`. The host, scheme, path and method are fixed. An explicitly configured integer port from 1024 through 65535 is permitted. The adapter never reads `OLLAMA_HOST`, proxy settings, credentials or custom headers, and it never queries available models or downloads one.

Supply an already installed local model name and consent for each API operation with `allowLocalModel: true`. CLI consent comes only from `--allow-local-model`, never from a config file. In default deterministic mode there is no network access. Creating a configured adapter only validates options; invoking its `generate` method performs the request.

```js
import { generateTestsWithOllama } from '@zofai/testgen';
const result = await generateTestsWithOllama({
  language: 'typescript',
  source: 'export function clamp(n: number) { return Math.min(5, n); }',
  functions: ['clamp'], module: '../fixture.ts',
  reproductions: [{ function: 'clamp', args: [10], expected: 5 }]
}, { allowLocalModel: true, model: 'qwen2.5-coder:1.5b', maxTokens: 1024 });
```

This example requires that specific model to be installed already. The clamp example itself is illustrative, not a claim of a measured execution result. The adapter sends selected function declarations, language, selected names, the module path and supplied reproductions. It omits unrelated declarations and imports. Treat included source and reproductions as data being shared with the local service.

Recognized credentials, URL patterns and sensitive keyed values in selected source, metadata or reproductions are rejected before the request, even with consent. Inputs and test oracles are not rewritten. Unrelated declarations remain omitted. This conservative check may reject benign synthetic data under sensitive keys and is not a guarantee of exhaustive secret detection.

Ollama supports cloud inference as well as local models. Use a trusted server with cloud features disabled, as described in the [Ollama FAQ](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features). The client rejects explicit cloud-tag model names but cannot establish whether an arbitrary server forwards data. No server settings are changed by this package.

## Limits and output

- Selected function source: 16 KiB; encoded request: 32 KiB.
- Requested output tokens: 16–4096, default 1024. The fixed context window request is 8192 tokens. See the public [model parameter reference](https://docs.ollama.com/modelfile).
- Network deadline: 100–120000 ms, default 30000, covering connection, headers and the complete response. Timeout aborts the request; there are no retries.
- Response headers: 8 KiB; received body: 256 KiB; generated candidate: 128 KiB. Byte limits apply during streaming reads, independent of the declared content length.
- Exactly one file with a fixed language-specific filename under `generated/`, plus at most 100 structured suggestions. Responses require a completed JSON envelope and a valid candidate schema. Redirects, compression, NDJSON, incomplete generation and malformed UTF-8 are rejected.

Requests set `stream: false`, a structured JSON output schema, finite `num_predict`, and fixed sampling options. The raw provider envelope, timing data, context, thinking text and provider errors are not returned. TypeScript candidates pass compiler parsing plus syntax-only checking of emitted JavaScript; Python candidates pass isolated AST parsing. An additional structural check requires a selected-module import, imported `node:test` registration and `node:assert/strict` assertions for TypeScript, or a `unittest.TestCase` with `test_` methods and assertions for Python. Unsupported candidates reject with `MODEL_CANDIDATE_FRAMEWORK_INVALID`. These checks never execute imports or test code and do not establish whole-project type correctness, runtime behavior, or safety. Known sensitive output patterns cause a fixed error; they are not silently removed from assertion values.

The provider grammar omits a large `maxLength` hint for candidate content because it can fail during grammar construction in Ollama. The client still enforces the 128 KiB candidate byte cap after the independently bounded 256 KiB response read, along with all schema, filename, syntax and privacy checks. Provider hints never replace client-side validation.

Model-generated candidates and proposed expected values are unverified. Review all code, imports, side effects and oracles before accepting a test. `--write` only creates a new candidate and rejects existing files. Actual execution belongs in a separately approved isolated environment.

Protocol tests use a controlled HTTP fixture, including packaged API/CLI tests. A separate isolated Ollama 0.13.5 / `qwen2.5-coder:0.5b` trial confirmed real transport, schema and syntax compatibility after the grammar repair. Its two candidates used unimported Jest globals and each failed under Node 22 on both buggy and corrected fixtures. That historical candidate failed regression acceptance. The current prompt specifies explicit native-framework imports and preservation of supplied reproduction values; structural validation rejects that observed wrong-framework output before returning it. See [validation](VALIDATION.md) for the current live acceptance scope. Other model/runtime combinations remain untested. Hosted Zof integration remains blocked pending an approved public contract.
