/**
 * Parroto — preflight.
 *
 * Node's built-in SQLite (`node:sqlite`) landed in Node 22.5, but until roughly 23.4 it sits
 * behind the `--experimental-sqlite` flag. Rather than making the user know that, this module
 * detects the situation and re-executes the process with the flag when it would help.
 *
 * Import this FIRST in any entry point (server, tools) and call `ensureSqlite()`.
 *
 *   import { ensureSqlite } from "./preflight.mjs";
 *   ensureSqlite();               // re-execs with the flag if needed, else continues
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** True when `node:sqlite` can be imported in this process right now. */
export function sqliteAvailable() {
  return probe([]);
}

/**
 * Runs a throwaway child process to test whether `node:sqlite` resolves.
 *
 * The probe MUST forward the current `execArgv`: if this process was itself started with
 * `--experimental-sqlite`, a child started without it fails and we would wrongly conclude the
 * flag is unsupported — which is exactly the bug that broke the test suite on Node 22.
 */
function probe(extraArgs) {
  const args = [...process.execArgv, ...extraArgs, "-e", "require('node:sqlite')"];
  return spawnSync(process.execPath, args, { stdio: "ignore" }).status === 0;
}

const FLAG = "--experimental-sqlite";

/**
 * Guarantees `node:sqlite` is importable.
 *
 * NOTE: in practice the launchers in `bin/` handle this before any app module loads, which is
 * the only reliable place — ESM imports are hoisted, so a guard inside a module runs *after*
 * that module's own imports have already been resolved. This function remains useful for
 * entry points that are run directly (`node tools/seed.mjs`).
 */
export function ensureSqlite({ silent = false } = {}) {
  if (sqliteAvailable()) return;

  const alreadyFlagged = process.execArgv.includes(FLAG);
  if (!alreadyFlagged && probe([FLAG])) {
    // The flag is needed and supported: restart ourselves with it.
    if (!silent) {
      console.log(`ℹ️  Node ${process.versions.node} needs ${FLAG} for built-in SQLite — ` +
                  `restarting with it.`);
    }
    const child = spawnSync(
      process.execPath,
      [FLAG, ...process.execArgv, process.argv[1], ...process.argv.slice(2)],
      { stdio: "inherit" },
    );
    process.exit(child.status ?? 0);
  }

  const major = Number(process.versions.node.split(".")[0]);
  const minor = Number(process.versions.node.split(".")[1] ?? 0);
  console.error("");
  console.error("❌  Parroto needs Node's built-in SQLite (node:sqlite).");
  console.error("");
  console.error(`    Running Node ${process.versions.node} at ${process.execPath}`);
  if (major < 22 || (major === 22 && minor < 5)) {
    console.error("    node:sqlite was added in Node 22.5 — this version is too old.");
  } else {
    console.error(`    ${FLAG} was not accepted by this build.`);
  }
  console.error("");
  console.error("    Fix: use Node 22.5 or newer, for example");
  console.error("      nvm install 22 && nvm use 22          (or any version >= 23.4)");
  console.error("      winget install OpenJS.NodeJS.LTS");
  console.error("");
  console.error("    Or, with Homebrew/Chocolatey:");
  console.error("      choco upgrade nodejs-lts");
  console.error("");
  process.exit(1);
}

/** A friendly one-line summary for `npm run doctor`. */
export function diagnostics() {
  const lines = [];
  const available = sqliteAvailable();
  const withFlag = probe([FLAG]);
  lines.push(`node          ${process.versions.node}`);
  lines.push(`executable    ${process.execPath}`);
  lines.push(`node:sqlite   ${available ? "available" : withFlag ? `available with ${FLAG}` : "UNAVAILABLE"}`);
  lines.push(`arch          ${process.platform}-${process.arch}`);
  return lines.join("\n");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  console.log(diagnostics());
}
