# Validation and release evidence

Run `npm run check` for strict TypeScript compilation plus named unit, integration, end-to-end and security tests. Run `npm run test:package` to build a tarball, install it into a temporary clean project with scripts disabled, load the public package exports and invoke the installed CLI. Tests use synthetic local fixtures, never customer data or hosted endpoints.

The CI matrix declares Node 22/24 on Linux/macOS/Windows; only completed jobs verify those platforms. Local candidate validation is separate from anonymous public installation, namespace/legal approval, protected release settings and independent security/QA review. Missing evidence remains unverified.

Ollama acceptance tests exercise the documented HTTP protocol against a controlled ephemeral loopback fixture, including no-consent behavior, fixed request shape, source minimization, output validation, deadlines, redirects, malformed data and packaged API/CLI invocation. They do not run a language model. A separate isolated Ollama 0.13.5 / qwen2.5-coder:0.5b trial confirmed transport/schema/syntax compatibility but failed generated-test execution because both candidates used unimported Jest globals. Both defective and corrected fixtures failed, so the trial does not establish successful regression detection.
