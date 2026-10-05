/* ==========================================================================
   Parroto — local neural voices (Piper TTS) + offline recognition (Whisper STT)

   One model family per direction, identical on every device:
     TTS  Piper via @mintplex-labs/piper-tts-web (MIT), voices mirrored from
          rhasspy/piper-voices (MIT) — ~60-73MB per language, ONNX on CPU.
     STT  Whisper tiny via @huggingface/transformers v3 (Apache-2.0),
          `Xenova/whisper-tiny` at q4f16 — one ~60-120MB download, 99 languages.

   Every CDN/model URL below returned HTTP 200 when pinned; pinning is deliberate.
   Nothing downloads until the learner taps Get: the bundle caches voices in OPFS
   and transformers caches its model in the browser, so each download happens once
   and both work offline afterwards. Web Speech stays the instant fallback.

   Pure helpers (voice map, fallback decision, resampling) have no DOM in them and
   are covered by tests/voice.test.mjs. Everything touching window/document/Audio
   lives behind functions, so the module imports cleanly in Node too.
   ========================================================================== */

export const PIPER_BUNDLE_URL =
  "https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.5/dist/piper-tts-web.js";
export const TRANSFORMERS_URL =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.web.js";
export const WHISPER_MODEL = "Xenova/whisper-tiny";
export const WHISPER_DTYPE = "q4f16";

/** voiceId plus the .onnx size in MB (the .json config is a few KB more). */
export const PIPER_VOICES = {
  es: { voiceId: "es_ES-sharvard-medium", mb: 73 },
  fr: { voiceId: "fr_FR-siwis-medium", mb: 60 },
  de: { voiceId: "de_DE-thorsten-medium", mb: 60 },
  it: { voiceId: "it_IT-paola-medium", mb: 60 },
  nb: { voiceId: "no_NO-talesyntese-medium", mb: 60 },
  sv: { voiceId: "sv_SE-nst-medium", mb: 60 },
};

/** Piper voice for a course TTS tag like "es-ES". Null when the language is covered. */
export function voiceIdFor(lang) {
  const prefix = String(lang ?? "").slice(0, 2).toLowerCase();
  return PIPER_VOICES[prefix]?.voiceId ?? null;
}

/** Whisper language code for a course TTS tag (Whisper knows Norwegian as "no"). */
export function whisperLangFor(lang) {
  const prefix = String(lang ?? "").slice(0, 2).toLowerCase();
  if (prefix === "nb") return "no";
  return prefix || "en";
}

/**
 * Who should speak: "local" (Piper ready), "system" (browser voice, or still loading
 * so best effort applies), or "none" (muted, unsupported, or no voice at all).
 * `systemStatus` is voiceStatus() from app.js; `localReady` is Voice.isReady(lang).
 */
export function resolveSpeech({ systemStatus, localReady }) {
  if (localReady) return "local";
  if (systemStatus === "ok" || systemStatus === "unknown") return "system";
  return "none";
}

/** Linear resampler for STT capture: any mic rate down (or up) to 16kHz Whisper input. */
export function resampleAudio(samples, fromRate, toRate) {
  const input = samples instanceof Float32Array ? samples : Float32Array.from(samples ?? []);
  if (!Number.isFinite(fromRate) || !Number.isFinite(toRate) || fromRate <= 0 || toRate <= 0) {
    throw new Error("resampleAudio needs positive rates");
  }
  if (input.length === 0) return new Float32Array(0);
  if (fromRate === toRate) return Float32Array.from(input);
  const outLen = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = (i * (input.length - 1)) / Math.max(1, outLen - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(input.length - 1, lo + 1);
    out[i] = input[lo] + (input[hi] - input[lo]) * (pos - lo);
  }
  return out;
}

/**
 * Pre-generated clips from `npm run voices`: /audio/<course>/<itemId>.mp3, indexed by
 * /audio/<course>.json. Missing manifest means no static audio — every lookup then
 * falls through to Piper or system speech, so undeployed courses keep working.
 */
export const StaticAudio = {
  _manifestPromises: new Map(),

  manifest(courseId) {
    if (!courseId) return Promise.resolve(null);
    if (!this._manifestPromises.has(courseId)) {
      this._manifestPromises.set(courseId,
        fetch(`/audio/${courseId}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    }
    return this._manifestPromises.get(courseId);
  },

  async urlFor(courseId, itemId) {
    if (!courseId || !itemId) return null;
    const m = await this.manifest(courseId);
    return m?.[itemId] ? `/${m[itemId]}` : null;
  },

  async play(url, rate = 0.9) {
    const el = new Audio(url);
    el.playbackRate = rate;
    await new Promise((resolve, reject) => {
      el.onended = resolve;
      el.onerror = () => reject(new Error("static playback failed"));
      el.play().catch(reject);
    });
  },
};

export const Voice = {
  /** Override in probes: (url) => module. Defaults to a real dynamic import. */
  _importer: (url) => import(url),

  _piperMod: null,
  _sessions: new Map(),   // lang tag -> TtsSession (ready to speak)
  _dlBusy: new Set(),     // lang tags currently downloading
  _whisperPipe: null,
  _whisperBusy: false,

  langPrefix(lang) {
    return String(lang ?? "").slice(0, 2).toLowerCase();
  },

  /** True when a Piper session is loaded and speakLocal() will work now. */
  isReady(lang) {
    return this._sessions.has(lang ?? "");
  },

  isDownloading(lang) {
    return this._dlBusy.has(lang ?? "");
  },

  whisperReady() {
    return !!this._whisperPipe;
  },

  /** Download (or load from OPFS cache) the Piper voice, then keep a live session. */
  async ensureVoice(lang, onProgress) {
    const voiceId = voiceIdFor(lang);
    if (!voiceId) throw new Error(`no Piper voice for ${lang ?? "this language"}`);
    if (this._sessions.has(lang)) return this._sessions.get(lang);
    if (!this._piperMod) {
      this._piperMod = await this._importer(PIPER_BUNDLE_URL);
    }
    this._dlBusy.add(lang);
    try {
      const cached = await this._piperMod.stored().catch(() => []);
      if (!cached.includes(voiceId)) {
        await this._piperMod.download(voiceId, onProgress);
      }
      const session = new this._piperMod.TtsSession({ voiceId, progress: onProgress });
      // Touch the session so a broken voice fails here, at download time, not mid-lesson.
      this._sessions.set(lang, session);
      return session;
    } finally {
      this._dlBusy.delete(lang);
    }
  },

  /** Speak with the ready Piper session. Throws when nothing is ready — call isReady first. */
  async speakLocal(text, lang, rate = 0.9) {
    const session = this._sessions.get(lang ?? "");
    if (!session) throw new Error("no local voice ready");
    const blob = await session.predict(String(text ?? ""));
    const url = URL.createObjectURL(blob);
    try {
      await new Promise((resolve, reject) => {
        const el = new Audio(url);
        el.playbackRate = rate;
        el.onended = resolve;
        el.onerror = () => reject(new Error("local playback failed"));
        el.play().catch(reject);
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  },

  /** Forget a downloaded voice (frees ~60MB). The next ensureVoice re-downloads it. */
  async removeVoice(lang) {
    const voiceId = voiceIdFor(lang);
    this._sessions.delete(lang ?? "");
    if (voiceId && this._piperMod) {
      await this._piperMod.remove(voiceId).catch(() => {});
    }
  },

  /** Load the Whisper pipeline (downloads once, then cached by transformers.js). */
  async ensureWhisper(onProgress) {
    if (this._whisperPipe) return this._whisperPipe;
    const mod = await this._importer(TRANSFORMERS_URL);
    this._whisperBusy = true;
    try {
      this._whisperPipe = await mod.pipeline("automatic-speech-recognition", WHISPER_MODEL, {
        dtype: WHISPER_DTYPE,
        progress_callback: onProgress,
      });
      return this._whisperPipe;
    } finally {
      this._whisperBusy = false;
    }
  },

  /** Record up to timeoutMs of mic audio and return mono 16kHz samples, or null. */
  async captureUtterance(timeoutMs = 7000) {
    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : null;
    if (!media?.getUserMedia) return null;
    let stream = null;
    try {
      stream = await media.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      const done = new Promise((resolve) => { rec.onstop = resolve; });
      rec.start();
      await new Promise((r) => setTimeout(r, timeoutMs));
      if (rec.state !== "inactive") rec.stop();
      await done;
      const bytes = await new Blob(chunks).arrayBuffer();
      const ctx = new AudioContext();
      try {
        const decoded = await ctx.decodeAudioData(bytes);
        const mono = new Float32Array(decoded.length);
        for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
          const data = decoded.getChannelData(ch);
          for (let i = 0; i < decoded.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
        }
        return { samples: resampleAudio(mono, decoded.sampleRate, 16000), rate: 16000 };
      } finally {
        await ctx.close().catch(() => {});
      }
    } catch {
      return null;
    } finally {
      stream?.getTracks().forEach((t) => t.stop?.());
    }
  },

  /** Transcribe captured audio with the loaded pipeline. Null when not ready. */
  async transcribe(samples, lang) {
    if (!this._whisperPipe || !samples?.length) return null;
    const out = await this._whisperPipe(samples, {
      language: whisperLangFor(lang),
      task: "transcribe",
    });
    const text = String(out?.text ?? "").trim();
    return text || null;
  },

  /** One call for the mic button: record and transcribe offline. Null on any failure. */
  async listenOffline(lang, { timeoutMs = 7000, onProgress } = {}) {
    const cap = await this.captureUtterance(timeoutMs);
    if (!cap) return null;
    if (!this._whisperPipe) {
      await this.ensureWhisper(onProgress).catch(() => null);
    }
    return this.transcribe(cap.samples, lang).catch(() => null);
  },
};
