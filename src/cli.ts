#!/usr/bin/env node
import {
  generateTests,
  readSource,
  writeCandidates,
  type GenerationInput,
} from "./index.js";
import { cliError, fail, parseJson, record } from "./common.js";
try {
  const args = process.argv.slice(2);
  if (args.includes("--help"))
    console.log(
      "zof-testgen CONFIG.json [--root DIR] [--write] [--json]\nDefault dry-run: review candidates without writing. Config: language, sourcePath, functions, module, reproductions. Never executes generated tests.",
    );
  else if (args.includes("--version")) console.log("0.1.0");
  else {
    let root = process.cwd(),
      write = false,
      json = false;
    const files: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--root") root = args[++i] ?? fail("ARGUMENT_REQUIRED");
      else if (args[i] === "--write") write = true;
      else if (args[i] === "--json") json = true;
      else if (args[i].startsWith("-")) fail("ARGUMENT_UNKNOWN");
      else files.push(args[i]);
    }
    if (files.length !== 1) fail("CONFIG_REQUIRED");
    const config = record(parseJson(await readSource(root, files[0])));
    if (typeof config.sourcePath !== "string") fail("SOURCE_PATH_REQUIRED");
    const result = generateTests({
      ...config,
      source: await readSource(root, config.sourcePath),
    } as unknown as GenerationInput);
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
