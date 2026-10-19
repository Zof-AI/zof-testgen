# API

`generateTests(input)` is deterministic and synchronous. Input fields: `language` (`typescript` or `python`), `source`, selected `functions`, `module`, optional `reproductions` (`function`, JSON `args`, JSON `expected`), and optional `coveredBranches` strings such as `clamp:2`. The result has `files` (`path`, `content`), `suggestions` (`function`, `kind`, `message`), fixed `warnings`, and `syntax` (`status`, `language`). Only syntax is validated; no execution result is implied.

`readSource(root, relativePath)` reads bounded UTF-8 source under an explicit root. `writeCandidates(root, result, {dryRun?})` defaults to true; passing false exclusively creates files. It returns relative file paths. Existing files and symlink paths are rejected. `localDeterministicAdapter` has ID `local-deterministic` and `generate: generateTests`. All input errors use `SafeInputError` with fixed safe code/message.

The CLI reads the same input from JSON except `sourcePath` replaces `source`. `--root` is the only file root; `--json` returns reviewable candidate content. Exit 0 means candidate generation and syntax validation completed; it does not mean the generated test passed. Exit 2 means invalid input, missing parser, unsupported functions or refused output. `--write` is explicit consent to local file creation, never test execution.

JSON input/source limits are 4 MiB, 100 selected functions and 1,000 reproductions. JSON nesting is limited to 48 and 100,000 values; TypeScript AST traversal is bounded. Python parsing runs in isolated interpreter mode without site packages, with a five-second timeout and bounded output. TypeScript parsing/transpilation uses the public TypeScript compiler and never loads tsconfig plugins.


`generateTestsWithOllama(input, options)` is async and returns the same GenerationResult shape with explicit model-generated warnings. Options require `allowLocalModel: true` and an installed local `model`; optional `port` (default 11434, 1024–65535), `maxTokens` (default 1024, 16–4096), and `timeoutMs` (default 30000, 100–120000). Unknown options and cloud-tag model names reject before network access. `createOllamaAdapter(options)` validates the options without connecting and returns `{id:'ollama-local', generate(input)}`. Neither API executes output.

The CLI accepts `--allow-local-model`, `--model`, `--ollama-port`, `--max-tokens`, and `--model-timeout-ms`. An optional `ollama` object in config supplies model/port/maxTokens/timeoutMs; CLI values override it. The consent flag is always required on the command line. A config that requests Ollama without the flag fails rather than silently contacting a service. Model files are fixed to `generated/zof-model-regression.test.ts` or `generated/test_zof_model_regression.py` and use the existing exclusive writer.

See [Ollama details](OLLAMA.md) for the transmitted data, protocol, limits, server trust boundary and verification status.
