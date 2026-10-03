/**
 * Parroto — preflight tests.
 *
 * Pins the Node-compatibility behaviour that let the app fail on the user's machine while
 * passing on mine: the launcher must detect a Node where `node:sqlite` needs
 * `--experimental-sqlite` and report it, and the probe must not give a false negative when the
 * flag is already active.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { sqliteAvailable, diagnostics } from "../src/preflight.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const launcher = join(root, "bin", "parroto.mjs");

test("sqlite is actually importable in this process", () => {
  // Whether directly or via the launcher, the suite can only run if this is true.
  assert.equal(sqliteAvailable(), true,
    "node:sqlite must be importable — run via `npm test` / bin/run-tests.mjs");
});

test("a bare import of node:sqlite works under the test runner", async () => {
  // Guards against the suite silently passing on a machine where the module is missing: if
  // this import throws, the whole file fails loudly.
  const mod = await import("node:sqlite");
  assert.ok(mod.DatabaseSync, "DatabaseSync should be exported");
  const db = new mod.DatabaseSync(":memory:");
  db.exec("CREATE TABLE t (x INTEGER)");
  db.prepare("INSERT INTO t VALUES (?)").run(42);
  assert.equal(db.prepare("SELECT x FROM t").get().x, 42);
  db.close();
});

test("the probe forwards the current exec flags, so it cannot give a false negative", () => {
  // The original bug: a probe child was started WITHOUT --experimental-sqlite, so on Node 22 it
  // always failed and the app declared itself unsupported even when the flag was active.
  const withoutFlag = spawnSync(process.execPath, ["-e", "require('node:sqlite')"], { stdio: "ignore" });
  const withForwarded = spawnSync(
    process.execPath,
    [...process.execArgv, "-e", "require('node:sqlite')"],
    { stdio: "ignore" });

  // The version that forwards our own flags is the one that must agree with sqliteAvailable().
  assert.equal(withForwarded.status === 0, sqliteAvailable(),
    "sqliteAvailable() must agree with a probe that forwards execArgv");
  assert.ok(withoutFlag.status === 0 || process.execArgv.includes("--experimental-sqlite"),
    "on a Node needing the flag, the flagless probe fails — which is why forwarding matters");
});

test("the launcher reports a usable environment", () => {
  const r = spawnSync(process.execPath, [launcher, "--doctor"], { encoding: "utf8" });
  assert.equal(r.status, 0, `--doctor should exit 0 on a working setup:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /node\s+\d+\.\d+\.\d+/, "it prints the node version");
  assert.match(r.stdout, /node:sqlite\s+(available|available with)/,
    "it reports sqlite as usable");
  assert.match(r.stdout, /✅/, "and gives a positive verdict");
});

test("diagnostics() produces a readable report", () => {
  const d = diagnostics();
  assert.match(d, /node\s+\d+\.\d+/);
  assert.match(d, /executable\s+\S+/);
  assert.match(d, /node:sqlite\s+\S+/);
});

test("the launcher starts the server without needing the flag passed by hand", () => {
  // End-to-end: run the launcher exactly as `npm start` does, on a spare port, and confirm it
  // actually binds and serves. This is the command the user types, and a previous version
  // silently did nothing because the boot check only matched argv[1] === "server.mjs".
  const port = 5391;
  const child = spawn(process.execPath, [launcher], {
    cwd: root,
    env: { ...process.env, PORT: String(port), PARROTO_DB: ":memory:", NODE_NO_WARNINGS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise((resolve, reject) => {
    let out = "";
    const done = (err) => {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      err ? reject(err) : resolve();
    };
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { out += d.toString(); });

    const timer = setTimeout(async () => {
      // Give up after a few seconds; report what we saw.
      done(new Error(`the launcher never served on port ${port}. Output:\n${out}`));
    }, 15000);

    const poll = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (res.ok) {
          const body = await res.json();
          clearTimeout(timer);
          if (body.ok !== true) return done(new Error("health did not report ok"));
          done();
          return;
        }
      } catch { /* not up yet */ }
      if (!child.killed) setTimeout(poll, 250);
    };
    setTimeout(poll, 250);

    child.on("exit", (code) => {
      // An early exit means it failed to serve.
      clearTimeout(timer);
      if (code !== null && code !== 0) {
        done(new Error(`the launcher exited with ${code}. Output:\n${out}`));
      }
    });
  });
});

test("the launcher does not re-exec itself in a loop", () => {
  // Regression: the probe omitted process.execArgv, so the child still appeared to lack
  // node:sqlite and re-exec'd again — each generation appending another copy of the flag,
  // spawning processes until the machine ran out.
  const r = spawnSync(process.execPath, [launcher, "--doctor"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!/-experimental-sqlite.*-experimental-sqlite/.test(r.stdout + r.stderr),
    "the flag must never be duplicated");
});

test("the probe result is stable once the flag is present", async () => {
  // Directly assert the invariant the loop bug violated: if this process already carries the
  // flag, the probe must agree that sqlite is available.
  if (!process.execArgv.includes("--experimental-sqlite")) return;   // n/a on modern Node
  const { sqliteAvailable } = await import("../src/preflight.mjs");
  assert.equal(sqliteAvailable(), true,
    "with --experimental-sqlite active, node:sqlite must be reported available");
});
