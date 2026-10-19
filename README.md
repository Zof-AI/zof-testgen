# Zof Testgen

Create deterministic, reviewable regression-test candidates for selected TypeScript and Python functions. Supplied bug reproductions become assertions; branch locations, boundary values and invalid-input cases become review suggestions. The tool parses source and validates generated syntax without executing either source or tests.

## Local installation

Use Node.js 22 or 24; Python examples require Python 3 with its standard-library AST parser available as `python3`.

```sh
npm ci --ignore-scripts
npm run build
npm test
npm pack --ignore-scripts
```

Install the tarball in another project with `npm install /absolute/path/to/package.tgz`. Candidate package name `@zof-ai/testgen`, intended repository URLs and public installation remain unverified until release approval. Proposed Apache-2.0 licensing needs owner/legal approval.

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

The bundled `localDeterministicAdapter` exposes `id` and `generate` for local integration. It is an oracle-driven generator, not a language model. Model-provider integrations and hosted generation are not implemented; no source is transmitted and no credentials are accepted. See [API](docs/API.md), [limitations](docs/LIMITATIONS.md) and [release gates](docs/RELEASE.md).
