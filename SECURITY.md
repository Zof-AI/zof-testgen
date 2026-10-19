# Security policy

The 0.1.x line is the initial supported candidate. Local analyses are bounded and offline unless an operation is explicitly documented otherwise. Do not provide production secrets or execute untrusted generated code.

Use GitHub private vulnerability reporting when enabled for this repository. If it is unavailable, contact an organization owner through an already verified private channel; do not file credentials, exploit details, or customer data in a public issue. A verified reporting channel must be enabled before public release. Reports will be triaged, reproduced using synthetic data, fixed and reviewed before coordinated disclosure. No response SLA is promised during prerelease development.

Optional Ollama generation requires explicit per-operation consent and a trusted local-only server. It sends selected function source and supplied reproductions to a fixed IPv4 loopback endpoint. It rejects cloud-tag model names, redirects, compressed or oversized responses, malformed output, unsafe filenames and known sensitive output patterns. It cannot verify the server's forwarding behavior. Generated code is untrusted, syntax validation is not a sandbox, and execution requires separate review and isolation.

Recognized sensitive generation metadata, reproduction inputs/expected values and selected model source are rejected before output or transmission. Rejection preserves the original oracle values rather than redacting them. The exported candidate writer also rejects recognized sensitive content. These known-pattern/key checks are conservative defense in depth, not an assertion that arbitrary encoded secrets are detectable.
