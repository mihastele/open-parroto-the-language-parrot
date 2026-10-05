/**
 * Parroto — static voice generation.
 *
 * Pre-synthesizes every vocabulary item with the course's Piper voice (the same voices
 * public/voice.js uses at runtime) and stores MP3 clips under public/audio/, plus one
 * manifest per course. The client plays these first: instant, offline-cacheable, and
 * identical on every device with zero per-learner downloads.
 *
 *   node tools/generate-voices.mjs [--course es-en] [--limit 5] [--force]
 *
 * Needs headless Chrome (drives the verified piper-tts-web bundle) and ffmpeg for
 * MP3 encoding (falls back to WAV without it). Skips clips that already exist, so
 * re-runs are incremental; voices download once into a persistent Chrome profile.
 * Generated files are gitignored — run this as a deploy step, not per commit.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { COURSES, allItems } from "../src/content/courses.mjs";
import { PIPER_BUNDLE_URL, voiceIdFor } from "../public/voice.js";

const OUT = join("public", "audio");
const PROFILE = "/tmp/parroto-voices-profile";
const DEBUG_PORT = 9233;

function args() {
  const out = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--force") out.force = true;
    else if (a === "--limit") out.limit = Number(process.argv[++i]);
    else if (a === "--course") out.course = process.argv[++i];
  }
  return out;
}

function hasFfmpegMp3() {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" });
  return r.status === 0 && /libmp3lame/.test(r.stdout);
}

function toMp3(wav, mp3) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y",
    "-i", wav, "-codec:a", "libmp3lame", "-q:a", "6", mp3]);
  return r.status === 0;
}

async function cdp() {
  const chrome = spawn("google-chrome", [
    "--headless=new", "--disable-gpu", "--no-sandbox",
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${PROFILE}`,
    "about:blank",
  ], { stdio: "ignore" });
  // Wait for the debugger endpoint.
  let list = null;
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://localhost:${DEBUG_PORT}/json/list`);
      list = await res.json();
      if (list.length) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!list?.length) { chrome.kill(); throw new Error("headless chrome never came up"); }
  const page = list.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(JSON.stringify(msg.error)));
      else res(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const myId = ++id;
    pending.set(myId, { res, rej });
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("predict failed: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result?.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  // The bundle imports the bare specifier "onnxruntime-web/wasm" (resolved by an import
  // map on piper-tts-web's own docs site), so install the same mapping here.
  await send("Page.setDocumentContent", {
    frameId: (await send("Page.getResourceTree")).frameTree.frame.id,
    html: `<!doctype html><html><head>
      <script type="importmap">${JSON.stringify({ imports: {
        "onnxruntime-web/wasm":
          "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/esm/ort.wasm.min.js",
      } })}</script>
      </head><body></body></html>`,
  });
  return { chrome, evaluate, close: () => { ws.close(); chrome.kill(); } };
}

// Runs inside headless chrome: loads the pinned bundle, ensures the voice, speaks.
const PREDICT_SRC = (bundleUrl, voiceId, text) => `(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return (async () => {
    globalThis.__piper ??= import(${JSON.stringify(bundleUrl)});
    const mod = await globalThis.__piper;
    globalThis.__sessions ??= {};
    globalThis.__sessions[${JSON.stringify(voiceId)}] ??= (async () => {
      const cached = await mod.stored().catch(() => []);
      if (!cached.includes(${JSON.stringify(voiceId)})) await mod.download(${JSON.stringify(voiceId)});
      return new mod.TtsSession({ voiceId: ${JSON.stringify(voiceId)} });
    })();
    const session = await globalThis.__sessions[${JSON.stringify(voiceId)}];
    const blob = await session.predict(${JSON.stringify(text)});
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 8192) {
      bin += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
    }
    return { base64: btoa(bin), type: blob.type };
  })();
})()`;

const { course: onlyCourse, limit, force } = args();
const mp3 = hasFfmpegMp3();
console.log(mp3 ? "encoding: mp3 (libmp3lame)" : "encoding: wav (no mp3 encoder found)");

const picked = COURSES.filter((c) => !onlyCourse || c.id === onlyCourse);
if (!picked.length) throw new Error(`unknown course ${onlyCourse}`);

const { chrome, evaluate, close } = await cdp();
try {
  for (const course of picked) {
    const voiceId = voiceIdFor(course.tts);
    if (!voiceId) { console.log(`${course.id}: no Piper voice, skipped`); continue; }
    const dir = join(OUT, course.id);
    mkdirSync(dir, { recursive: true });
    const manifestPath = join(OUT, `${course.id}.json`);
    const manifest = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};

    let items = allItems(course);
    if (limit) items = items.slice(0, limit);
    let made = 0, skipped = 0;
    for (const item of items) {
      const ext = mp3 ? "mp3" : "wav";
      const file = join(dir, `${item.id}.${ext}`);
      manifest[item.id] = `audio/${course.id}/${item.id}.${ext}`;
      if (existsSync(file) && !force) { skipped++; continue; }
      const wav = join(dir, `${item.id}.wav`);
      const { base64 } = await evaluate(PREDICT_SRC(PIPER_BUNDLE_URL, voiceId, item.target));
      writeFileSync(wav, Buffer.from(base64, "base64"));
      if (mp3) {
        const mp3file = join(dir, `${item.id}.mp3`);
        if (toMp3(wav, mp3file)) {
          rmSync(wav);
        } else {
          manifest[item.id] = `audio/${course.id}/${item.id}.wav`;
        }
      }
      made++;
      if (made % 10 === 0) console.log(`${course.id}: ${made} clips…`);
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + "\n");
    console.log(`${course.id}: ${made} generated, ${skipped} skipped, manifest ${manifestPath}`);
  }
} finally {
  close();
}
