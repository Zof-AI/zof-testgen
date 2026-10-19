#!/usr/bin/env node
import {
  generateTests,
  generateTestsWithOllama,
  readSource,
  writeCandidates,
  type GenerationInput,
  type OllamaOptions,
} from "./index.js";
import { cliError, fail, parseJson, record } from "./common.js";
try {
  const args = process.argv.slice(2);
  if (args.includes("--help"))
    console.log(
      "zof-testgen CONFIG.json [--root DIR] [--write] [--json]\nOptional: --allow-local-model --model NAME [--ollama-port PORT] [--max-tokens N] [--model-timeout-ms N]\nDefault dry-run uses deterministic generation without network. --allow-local-model explicitly sends selected function source and supplied reproductions to a trusted local-only Ollama server at 127.0.0.1 (default port 11434). Never executes generated tests.",
    );
  else if (args.includes("--version")) console.log("0.1.0");
  else {
    let root = process.cwd(),
      write = false,
      json = false,
      allowLocalModel = false;
    const modelOverrides: Record<string, unknown> = {};
    const files: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--root") root = args[++i] ?? fail("ARGUMENT_REQUIRED");
      else if (args[i] === "--write") write = true;
      else if (args[i] === "--json") json = true;
      else if (args[i] === "--allow-local-model") allowLocalModel = true;
      else if (args[i] === "--model")
        modelOverrides.model = args[++i] ?? fail("ARGUMENT_REQUIRED");
      else if (args[i] === "--ollama-port")
        modelOverrides.port = Number(args[++i] ?? fail("ARGUMENT_REQUIRED"));
      else if (args[i] === "--max-tokens")
        modelOverrides.maxTokens = Number(
          args[++i] ?? fail("ARGUMENT_REQUIRED"),
        );
      else if (args[i] === "--model-timeout-ms")
        modelOverrides.timeoutMs = Number(
          args[++i] ?? fail("ARGUMENT_REQUIRED"),
        );
      else if (args[i].startsWith("-")) fail("ARGUMENT_UNKNOWN");
      else files.push(args[i]);
    }
    if (files.length !== 1) fail("CONFIG_REQUIRED");
    const config = record(parseJson(await readSource(root, files[0])));
    if (typeof config.sourcePath !== "string") fail("SOURCE_PATH_REQUIRED");
    const modelConfig =
      config.ollama === undefined ? {} : record(config.ollama);
    if (
      !allowLocalModel &&
      (config.ollama !== undefined || Object.keys(modelOverrides).length)
    )
      fail("LOCAL_MODEL_CONSENT_REQUIRED");
    const input = {
      language: config.language,
      functions: config.functions,
      module: config.module,
      ...(config.reproductions !== undefined
        ? { reproductions: config.reproductions }
        : {}),
      ...(config.coveredBranches !== undefined
        ? { coveredBranches: config.coveredBranches }
        : {}),
      source: await readSource(root, config.sourcePath),
    } as GenerationInput;
    const result = allowLocalModel
      ? await generateTestsWithOllama(input, {
          ...modelConfig,
          ...modelOverrides,
          allowLocalModel: true,
        } as unknown as OllamaOptions)
      : generateTests(input);
    const paths = await writeCandidates(root, result, { dryRun: !write });
    if (json)
      console.log(JSON.stringify({ ...result, written: write }, null, 2));
    else
      console.log(
        (write ? "Created " : "Dry-run candidate: ") +
          paths.join(", ") +
          "\n" +
          result.warnings.join("\n"),
      );
  }
} catch (error) {
  cliError(error);
}
