# Zof Testgen

Create reviewable regression-test candidates for selected TypeScript and Python functions. Supplied bug reproductions become assertions; branch locations, boundary values and invalid-input cases become review suggestions. Default generation is deterministic and offline. An opt-in Ollama adapter can generate additional candidates through a trusted local model server. Both modes validate syntax without executing source or tests. Model candidates also need the supported test framework structure and an import of the selected module.

<!-- ZOF_NPM_INSTALL_START -->
## Install from npm

Use Node.js 22 or 24 and npm. File-based operations require Linux or macOS with Python 3.10 or newer; Windows file operations fail closed. In a new project directory, install the version used by this guide:

```sh
npm install --ignore-scripts --save-exact @zof-ai/testgen@0.1.1
npx --no-install zof-testgen --help
```

The package includes compiled JavaScript, TypeScript declarations and its runtime dependencies. No source build, Zof account or repository upload is required. `--ignore-scripts` disables installation lifecycle scripts; `--no-install` keeps the example commands from downloading another package.

Confirm the public ESM entry point; this prints `function`:

```sh
node --input-type=module -e "import('@zof-ai/testgen').then(api => console.log(typeof api.generateTests))"
```

Run a packaged example from the same directory:

```sh
npx --no-install zof-testgen config.json --root node_modules/@zof-ai/testgen/examples/typescript-regression --json
```

The dry run returns a reviewable TypeScript regression candidate without executing it or writing a file.

Package: [@zof-ai/testgen](https://www.npmjs.com/package/@zof-ai/testgen). The source-checkout instructions and three additional workflows follow.
<!-- ZOF_NPM_INSTALL_END -->

<!-- ZOF_RELEASE_INSTALL_START -->
## Install from GitHub source

Requires Node.js 22 or 24, npm, and Git. Filesystem operations require Linux or macOS with Python 3.10 or newer; Windows file operations fail closed. Clone this repository and explicitly prepare its reviewed release dependencies:

```sh
git clone --branch v0.1.1 --depth 1 https://github.com/Zof-AI/zof-testgen.git
cd zof-testgen
node scripts/bootstrap.mjs --allow-network
npm ci --ignore-scripts --prefer-offline
npm run build
npm test
```

The bootstrap downloads only the exact versioned dependency assets from [GitHub Releases](https://github.com/Zof-AI/zof-testgen/releases), as listed in `scripts/release-dependencies.json`, verifies SHA256 and byte size, and adds them to the npm cache. It does not extract archives, run package scripts, collect application data, or send credentials. Downloads require the explicit flag and follow only HTTPS GitHub asset redirects. Installation then fetches ordinary third-party dependencies from npm. Use a writable npm cache; set `npm_config_cache` consistently for both commands if needed. An unavailable asset, changed hash, or oversized response stops installation.

<!-- ZOF_RELEASE_INSTALL_END -->

## Source development

Use Node.js 22 or 24 on Linux or macOS with Python 3.10 or later available as `python3`. The shared file-access helper uses isolated Python standard-library descriptor operations; Python generation also needs its AST parser. File reads and writes fail closed on Windows or if the helper is unavailable. Pure in-memory TypeScript generation has no Python requirement.

For source development, follow the pinned GitHub installation above. `npm run build`, `npm test` and `npm pack --ignore-scripts` build, check and package the checkout. Runtime dependencies install automatically with the npm package.


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
node dist/cli.js config.json --root examples/typescript-regression --allow-local-model --model qwen2.5-coder:1.5b --json
```

Choose an installed model name. `--allow-local-model` authorizes sending the selected function declarations, function/module names and supplied reproductions to `http://127.0.0.1:11434/api/generate`. Unselected declarations and imports are omitted. The default remains a dry-run; `--write` separately creates the validated candidate. Configuration alone cannot grant transmission consent. No model is downloaded or run automatically before this explicit request.

Ollama can forward cloud models, so run a trusted server with cloud features disabled. Explicit cloud-tag model names are rejected; the client cannot attest how a separately administered server handles a request. Model outputs and proposed oracles remain unverified suggestions. The adapter rejects candidates that omit native framework imports, the selected-module import, test registration, or assertions. This structural check does not prove runtime compatibility, oracle correctness, or freedom from side effects. Controlled protocol tests use a separate synthetic HTTP server; see the recorded scope in [validation](docs/VALIDATION.md).

`localDeterministicAdapter` exposes the offline generator. `createOllamaAdapter(options)` and `generateTestsWithOllama(input, options)` expose the async model path. See [Ollama configuration and protocol](docs/OLLAMA.md), [API](docs/API.md), [limitations](docs/LIMITATIONS.md) and [release gates](docs/RELEASE.md).
