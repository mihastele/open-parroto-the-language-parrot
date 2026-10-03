/**
 * Parroto — test launcher.
 *
 * Two jobs:
 *   1. `node --test tests/` fails with MODULE_NOT_FOUND; this passes a glob instead.
 *   2. It adds `--experimental-sqlite` when the running Node needs it, so the suite passes on
 *      Node 22.5–23.x as well as on modern Node.
 *
 * Uses a child process rather than re-exec'ing itself, because Node's own test runner owns the
 * process tree and the flag has to reach it directly.
 */

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FLAG = "--experimental-sqlite";

function sqliteWorks(extraArgs = []) {
  return spawnSync(process.execPath, [...extraArgs, "-e", "require('node:sqlite')"],
    { stdio: "ignore" }).status === 0;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = join(root, "tests");
const pattern = process.argv[2] ?? "*.test.mjs";

// The test files live in tests/; Node's runner wants a path or glob, not a bare directory.
const files = readdirSync(testsDir)
  .filter((f) => f.endsWith(".test.mjs"))
  .filter((f) => new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$").test(f))
  .map((f) => join(testsDir, f));

if (files.length === 0) {
  console.error(`No test files matched ${pattern} in ${testsDir}`);
  process.exit(1);
}

const args = ["--test"];
if (!sqliteWorks()) {
  if (!sqliteWorks([FLAG])) {
    console.error("");
    console.error("❌  This Node (" + process.versions.node + ") has no usable node:sqlite.");
    console.error("    Parroto tests need Node 22.5 or newer. Run `npm run doctor` for details.");
    console.error("");
    process.exit(1);
  }
  args.push(FLAG);
}
args.push(...files, ...process.argv.slice(3));

console.log(`running ${files.length} test file(s) on node ${process.versions.node}` +
            (args.includes(FLAG) ? ` with ${FLAG}` : ""));
console.log("");

const child = spawnSync(process.execPath, args, {
  stdio: "inherit",
  cwd: root,
  // Node 22 prints an ExperimentalWarning for node:sqlite on every worker; it is expected and
  // only adds noise to the summary.
  env: { ...process.env, NODE_NO_WARNINGS: process.env.NODE_NO_WARNINGS ?? "1" },
});
process.exit(child.status ?? 0);
