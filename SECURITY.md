# Security policy

The 0.1.x line is the initial supported release line. Local analyses are bounded and offline unless an operation is explicitly documented otherwise. Do not provide production secrets or execute untrusted generated code.

Use GitHub private vulnerability reporting when enabled for this repository. If it is unavailable, contact an organization owner through an already verified private channel; do not file credentials, exploit details, or customer data in a public issue. Reports will be triaged, reproduced using synthetic data, fixed and reviewed before coordinated disclosure. No response SLA is promised for this initial release.

Optional Ollama generation requires explicit per-operation consent and a trusted local-only server. It sends selected function source and supplied reproductions to a fixed IPv4 loopback endpoint. It rejects cloud-tag model names, redirects, compressed or oversized responses, malformed output, unsafe filenames and known sensitive output patterns. It cannot verify the server's forwarding behavior. Generated code is untrusted, syntax validation is not a sandbox, and execution requires separate review and isolation.

Recognized sensitive generation metadata, reproduction inputs/expected values and selected model source are rejected before output or transmission. Rejection preserves the original oracle values rather than redacting them. The exported candidate writer also rejects recognized sensitive content. These known-pattern/key checks are conservative defense in depth, not an assertion that arbitrary encoded secrets are detectable.

File reads and exclusive writes delegate to evidence-spec descriptor-based path traversal with no-follow semantics on Linux/macOS. Python 3.10 or later is a required file-access runtime; unsupported platforms fail closed. Candidate framework checks are structural compatibility checks, not a sandbox or a proof that model-generated code is safe.

Filesystem operations use bounded, directory-relative descriptors on Linux/macOS with Python 3.10 or newer. Symlinks, hard-linked inputs, special files and traversal are rejected. Open descriptors remain attached to the original directory when names change. File contents can still change during a read or snapshot; this is not an atomic filesystem snapshot. Windows filesystem operations fail closed; in-memory JSON validation and analysis do not require the file helper.
