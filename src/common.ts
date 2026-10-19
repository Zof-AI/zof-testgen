import { redactText, safeReadFile } from "@zof-ai/evidence-spec";
import { isAbsolute } from "node:path";
export const MAX_INPUT_BYTES = 4 * 1024 * 1024;
export type Severity = "info" | "low" | "medium" | "high" | "critical";
export interface Finding {
  id: string;
  severity: Severity;
  message: string;
  path?: string;
}
export class SafeInputError extends Error {
  constructor(public readonly code: string) {
    super(`Input rejected (${code}).`);
    this.name = "SafeInputError";
  }
}
export function fail(code: string): never {
  throw new SafeInputError(code);
}
export function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail("OBJECT_REQUIRED");
  return v as Record<string, unknown>;
}
export function guard(
  v: unknown,
  depth = 0,
  budget = { n: 0, bytes: 0 },
): void {
  if (depth > 48 || ++budget.n > 100000) fail("INPUT_COMPLEXITY");
  if (v === null || typeof v === "boolean") return;
  if (typeof v === "string") {
    budget.bytes += Buffer.byteLength(v);
    if (budget.bytes > MAX_INPUT_BYTES) fail("INPUT_SIZE");
    return;
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) fail("NUMBER_INVALID");
    return;
  }
  if (typeof v !== "object") fail("JSON_REQUIRED");
  if (
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) !== Object.prototype &&
    Object.getPrototypeOf(v) !== null
  )
    fail("JSON_REQUIRED");
  for (const d of Object.values(Object.getOwnPropertyDescriptors(v))) {
    if (d.get || d.set) fail("ACCESSOR_REJECTED");
    guard(d.value, depth + 1, budget);
  }
}
export function parseJson(text: string): unknown {
  if (Buffer.byteLength(text) > MAX_INPUT_BYTES) fail("INPUT_SIZE");
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    fail("JSON_INVALID");
  }
  guard(v);
  return v;
}
export function relativePath(path: string): void {
  if (
    typeof path !== "string" ||
    path.length > 512 ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.includes(":") ||
    path.split("/").some((x) => !x || x === "." || x === "..")
  )
    fail("PATH_INVALID");
}
export async function readBounded(root: string, path: string): Promise<string> {
  relativePath(path);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      await safeReadFile(root, path, MAX_INPUT_BYTES),
    );
  } catch {
    fail("FILE_UNAVAILABLE");
  }
}

const severityOrder: Severity[] = ["info", "low", "medium", "high", "critical"];
export function severity(value: unknown): Severity {
  if (!severityOrder.includes(value as Severity)) fail("SEVERITY_INVALID");
  return value as Severity;
}
export function exceeds(
  findings: Finding[],
  level: Severity = "high",
): boolean {
  return findings.some(
    (f) => severityOrder.indexOf(f.severity) >= severityOrder.indexOf(level),
  );
}
export function display(path: string): string {
  path = redactText(path);
  return /^[\w/.{}~:$ -]{1,400}$/.test(path) && !path.includes("://")
    ? path
    : "[location omitted]";
}
export function markdown(
  title: string,
  findings: Finding[],
  limitations: string[],
): string {
  return (
    `# ${title}\n\n` +
    (findings.length
      ? findings
          .map(
            (f) =>
              `- **${f.severity}** ${f.id}: ${f.message}${f.path ? " (" + display(f.path) + ")" : ""}`,
          )
          .join("\n")
      : "No findings in the supported static checks.") +
    "\n\nLimitations:\n" +
    limitations.map((s) => "- " + s).join("\n") +
    "\n"
  );
}
export function cliError(error: unknown): void {
  process.stderr.write(
    error instanceof SafeInputError
      ? error.message + "\n"
      : "Operation failed safely.\n",
  );
  process.exitCode = 2;
}
