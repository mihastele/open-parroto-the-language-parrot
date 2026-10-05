/**
 * Parroto — local voice config tests.
 *
 * Covers the pure part of public/voice.js: the Piper voice map (every course language
 * resolves), the speech fallback decision, and the STT resampler. Browser providers
 * (dynamic imports, Audio, mic) are exercised by a stub-DOM probe instead.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PIPER_VOICES,
  voiceIdFor,
  whisperLangFor,
  resolveSpeech,
  resampleAudio,
} from "../public/voice.js";

test("every course language resolves to a Piper voice", () => {
  for (const [prefix, v] of Object.entries(PIPER_VOICES)) {
    assert.match(v.voiceId, /^[a-z]{2}_[A-Z]{2}-.+-(low|x_low|medium|high)$/, `${prefix} voice id shape`);
    assert.ok(v.mb > 0, `${prefix} states a download size`);
  }
  assert.equal(voiceIdFor("es-ES"), PIPER_VOICES.es.voiceId);
  assert.equal(voiceIdFor("nb-NO"), PIPER_VOICES.nb.voiceId, "Bokmål maps to the no_NO voice");
  assert.equal(voiceIdFor("xx-YY"), null, "unknown languages have no voice");
  assert.equal(voiceIdFor(undefined), null);
});

test("whisper language codes follow the TTS tag, except Norwegian", () => {
  assert.equal(whisperLangFor("es-ES"), "es");
  assert.equal(whisperLangFor("sv-SE"), "sv");
  assert.equal(whisperLangFor("nb-NO"), "no", "whisper knows Norwegian as no");
});

test("speech falls back from local to system to none", () => {
  const cases = [
    [{ systemStatus: "unsupported", localReady: true }, "local"],
    [{ systemStatus: "missing", localReady: true }, "local"],
    [{ systemStatus: "muted", localReady: true }, "local", "an explicit replay still uses local"],
    [{ systemStatus: "ok", localReady: false }, "system"],
    [{ systemStatus: "unknown", localReady: false }, "system", "best effort while voices load"],
    [{ systemStatus: "missing", localReady: false }, "none"],
    [{ systemStatus: "unsupported", localReady: false }, "none"],
    [{ systemStatus: "muted", localReady: false }, "none"],
  ];
  for (const [input, expected, hint] of cases) {
    assert.equal(resolveSpeech(input), expected, hint ?? JSON.stringify(input));
  }
});

test("the resampler keeps shape across rates", () => {
  assert.deepEqual([...resampleAudio(new Float32Array(0), 48000, 16000)], []);
  assert.throws(() => resampleAudio([1], 0, 16000), /positive rates/);

  const tone = Float32Array.from({ length: 480 }, (_, i) => Math.sin((i / 48) * 2 * Math.PI));
  const same = resampleAudio(tone, 16000, 16000);
  assert.equal(same.length, tone.length);
  assert.ok(same.every((v, i) => v === tone[i]), "identity copies exactly");

  const down = resampleAudio(tone, 48000, 16000);
  assert.equal(down.length, 160, "length scales with the rate ratio");
  let peak = 0;
  for (const v of down) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak > 0.9, "a full-scale tone survives downsampling");

  const up = resampleAudio(Float32Array.from([0, 1]), 8000, 16000);
  assert.equal(up.length, 4);
  assert.ok(up[0] === 0 && up[3] === 1, "endpoints are exact");
  assert.ok(up[1] > 0 && up[1] < up[2], "interior points interpolate");
});
