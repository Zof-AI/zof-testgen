# Zof Testgen

Create reviewable regression-test candidates for selected TypeScript and Python functions. Supplied bug reproductions become assertions; branch locations, boundary values and invalid-input cases become review suggestions. Default generation is deterministic and offline. An opt-in Ollama adapter can generate additional candidates through a trusted local model server. Both modes validate syntax without executing source or tests.

## Local installation

Use Node.js 22 or 24; Python examples require Python 3 with its standard-library AST parser available as `python3`. This prerelease depends on the reviewed `@zof-ai/evidence-spec` 0.1.0 candidate. Install both local artifacts together; public registry installation remains blocked until the dependency and this package are approved and published.

```sh
npm install --ignore-scripts /path/to/zof-ai-evidence-spec-0.1.0.tgz /path/to/zof-ai-testgen-0.1.0.tgz
```

For source development, first stage the reviewed evidence candidate and install the locked development dependencies. Then run:

```sh
npm run build
npm test
npm pack --ignore-scripts
```

The lockfile retains portable semver dependencies. A standalone public `npm ci` cannot be verified before those dependencies are published. Candidate package name `@zof-ai/testgen`, intended repository URLs and public installation remain unverified until release approval. Proposed Apache-2.0 licensing needs owner/legal approval.

## Three examples

```sh
# Explicit TypeScript regression oracles; default dry-run
node dist/cli.js config.json --root examples/typescript-regression --json
# Python unit-test candidates; creates a new file only with --write
node dist/cli.js config.json --root examples/python-regression --write --json
# Branch suggestions without an oracle: generated test is marked TODO
node dist/cli.js config.json --root examples/branch-review --json
```

`--write` exclusively creates a file under `generated/`; it never overwrites an existing file. Default dry-run returns the complete candidate in JSON without touching disk. A repeated write returns exit 2. Review candidates and expected values before execution. For the supplied trusted TypeScript example, write once and run `node --experimental-strip-types --test generated/zof-regression.test.ts` from the example directory. For the Python example, run `python3 -m unittest discover -s generated` from its directory. These commands are manual acceptance steps and execute the example module.

Use synthetic inputs. Recognized credentials and sensitive keyed values in reproductions or generation metadata are rejected before output. Expected results are never silently redacted or changed. The local-model path also checks selected source before transmitting it.

## Library

```js
import { generateTests, readSource, writeCandidates } from '@zof-ai/testgen';
const result = generateTests({
  language: 'typescript', source: await readSource(process.cwd(), 'fixture.ts'),
  functions: ['clamp'], module: '../fixture.ts',
  reproductions: [{ function: 'clamp', args: [10], expected: 5 }]
});
await writeCandidates(process.cwd(), result); // dry-run by default
```

## Optional local model generation

With a trusted local-only Ollama server already running and the selected model already installed:

```sh
node dist/cli.js config.json --root examples/typescript-regression --allow-local-model --model llama3.2:3b --json
```

Choose an installed model name. `--allow-local-model` authorizes sending the selected function declarations, function/module names and supplied reproductions to `http://127.0.0.1:11434/api/generate`. Unselected declarations and imports are omitted. The default remains a dry-run; `--write` separately creates the validated candidate. Configuration alone cannot grant transmission consent. No model is downloaded or run automatically before this explicit request.

Ollama can forward cloud models, so run a trusted server with cloud features disabled. Explicit cloud-tag model names are rejected; the client cannot attest how a separately administered server handles a request. Model outputs and proposed oracles remain unverified suggestions. No live language-model acceptance has been run for this candidate; controlled protocol tests use a synthetic HTTP server.

`localDeterministicAdapter` exposes the offline generator. `createOllamaAdapter(options)` and `generateTestsWithOllama(input, options)` expose the async model path. See [Ollama configuration and protocol](docs/OLLAMA.md), [API](docs/API.md), [limitations](docs/LIMITATIONS.md) and [release gates](docs/RELEASE.md).
