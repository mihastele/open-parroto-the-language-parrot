/**
 * Parroto — launcher.
 *
 * Exists for one reason: Node 22.5–23.x only exposes `node:sqlite` behind
 * `--experimental-sqlite`, and an `import "node:sqlite"` inside the app would fail during ESM
 * resolution — *before* any in-file guard could run, because ESM imports are hoisted.
 *
 * So the check has to happen here, in a process that imports nothing, and the app is loaded
 * with a dynamic `import()` afterwards. If the flag is needed, we re-exec with it.
 *
 *   node bin/parroto.mjs               start the server
 *   node bin/parroto.mjs --doctor      print environment diagnostics
 */

import { spawn, spawnSync } from "node:child_process";

const FLAG = "--experimental-sqlite";

/**
 * Can a fresh process import `node:sqlite`?
 *
 * The probe forwards the CURRENT `execArgv`, and this is load-bearing: `--experimental-sqlite`
 * is not inherited by a child started without it. A probe that omitted it would report
 * "unavailable" even in a process that already has the flag, and the launcher would re-exec
 * itself forever — each generation adding another copy of the flag.
 */
function sqliteWorks(extra = []) {
  const args = [...process.execArgv, ...extra, "-e", "require('node:sqlite')"];
  return spawnSync(process.execPath, args, { stdio: "ignore" }).status === 0;
}

const alreadyFlagged = process.execArgv.includes(FLAG);

if (process.argv.includes("--doctor")) {
  const worksNow = sqliteWorks();
  const worksWithFlag = alreadyFlagged || sqliteWorks([FLAG]);
  console.log("Parroto environment check");
  console.log("  node          " + process.versions.node);
  console.log("  executable    " + process.execPath);
  console.log("  platform      " + process.platform + "-" + process.arch);
  console.log("  node:sqlite   " + (worksNow
    ? "available"
    : worksWithFlag ? `available with ${FLAG}` : "UNAVAILABLE"));
  console.log("");
  console.log(worksNow
    ? "✅ This Node can run Parroto directly."
    : worksWithFlag
      ? "✅ This Node can run Parroto — the launcher adds the flag for you."
      : "❌ This Node is too old. node:sqlite needs Node 22.5 or newer.");
  process.exit(worksNow || worksWithFlag ? 0 : 1);
}

if (!sqliteWorks()) {
  // If we are already flagged and it still does not work, re-execing cannot help — and would
  // loop forever, adding a copy of the flag on every generation.
  if (!alreadyFlagged && sqliteWorks([FLAG])) {
    // Re-exec this same script with the flag.
    //
    // We `spawn` (async) rather than `spawnSync` and forward termination signals to the child:
    // with spawnSync, killing the parent leaves the child orphaned and still bound to the port,
    // so repeated starts accumulate stray servers holding the database open.
    const child = spawn(
      process.execPath,
      [FLAG, ...process.execArgv, process.argv[1], ...process.argv.slice(2)],
      { stdio: "inherit" },
    );

    const forward = (signal) => () => {
      if (!child.killed) child.kill(signal);
    };
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
      try { process.on(sig, forward(sig)); } catch { /* not supported on this platform */ }
    }
    // If the child dies on its own, follow it.
    child.on("exit", (code) => process.exit(code ?? 0));

    // Keep the parent alive as a thin supervisor.
    await new Promise(() => {});
  }

  console.error("");
  console.error("❌  Parroto needs Node's built-in SQLite (node:sqlite).");
  console.error("");
  console.error("    Running Node " + process.versions.node + " at " + process.execPath);
  console.error("    node:sqlite was added in Node 22.5, and needs " + FLAG +
                " until Node ~23.4.");
  console.error("");
  console.error("    Fix it with either:");
  console.error("      winget install OpenJS.NodeJS.LTS        (Windows)");
  console.error("      choco upgrade nodejs-lts                (Chocolatey)");
  console.error("      brew install node                       (macOS)");
  console.error("");
  console.error("    Then check with:  npm run doctor");
  console.error("");
  process.exit(1);
}

// Only now load the app, so nothing tries to resolve node:sqlite too early.
const { startServer } = await import("../src/server.mjs");
startServer();
