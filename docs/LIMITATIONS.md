# Scope and limitations

TypeScript support selects named exported top-level synchronous function declarations with bodies. Python support selects top-level synchronous function definitions. Class methods, TypeScript arrow functions, async functions and generators are outside the supported initial scope. Functions must be explicitly selected; the tool does not decide which Git changes matter.

Without a supplied expected result there is no test oracle: generated TypeScript tests are TODO and Python tests are skipped. Boundary and invalid-input suggestions are advisory prose. Covered-branch IDs are caller-supplied hints, never measured coverage or proof that a branch is tested. TypeScript validation checks syntax, not whole-project types, imports or runtime compatibility. Python parsing does not execute imports, decorators or module statements.

Generated tests do execute the selected module when a user later accepts and runs them. Review that module, imports and fixtures first and use an isolated execution environment for untrusted code. No generated test is automatically run, uploaded, guaranteed to catch every defect or labeled verified. The automated synthetic acceptance proves only the supplied known clamp bug is detected and its correction passes in both supported languages.

Output paths are fixed under generated/. Do not concurrently replace workspace directories while generation or writes are in progress. No hosted provider or local language-model adapter is implemented; this release exposes a local deterministic adapter only. Hosted work requires an approved public contract and informed source-transmission consent. No Zof endpoint is assumed.
