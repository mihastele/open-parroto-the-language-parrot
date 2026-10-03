/**
 * Parroto — sound effects.
 *
 * Every sound is synthesised in the browser with the Web Audio API, so the app still ships
 * zero asset files and works offline. The alternative — bundling mp3s — would add megabytes
 * and licensing questions for no benefit at this scale.
 *
 * The design goal is "arcade, not annoying": short, warm, and never loud enough to startle.
 * Correct answers climb in pitch as the combo grows, which is the main thing that makes a good
 * run *feel* good. Everything respects the sound setting and fails silently when the browser
 * blocks audio (e.g. before the first user gesture).
 */

const Sound = (() => {
  let ctx = null;
  let enabled = true;
  let master = null;
  let unlocked = false;

  /** Lazily create the audio context; browsers require a user gesture first. */
  function ensure() {
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.22;          // deliberately gentle
      master.connect(ctx.destination);
      return ctx;
    } catch {
      return null;
    }
  }

  /** Call on the first click/keypress so later sounds are allowed to play. */
  function unlock() {
    const c = ensure();
    if (c && !unlocked) unlocked = true;
  }

  function setEnabled(on) {
    enabled = !!on;
  }

  /**
   * One shaped tone. `type` picks the waveform, and a short attack/decay envelope stops the
   * clicks that raw oscillators produce.
   */
  function tone({ freq, duration = 0.14, type = "sine", gain = 1, delay = 0, sweepTo = null, attack = 0.008 }) {
    if (!enabled) return;
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t0 + duration);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g); g.connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  /** Short filtered noise, used for the "whoosh"/tick of a tile being placed. */
  function noise({ duration = 0.06, gain = 0.35, delay = 0, freq = 1200, q = 0.8 }) {
    if (!enabled) return;
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const frames = Math.max(1, Math.floor(c.sampleRate * duration));
    const buf = c.createBuffer(1, frames, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = c.createBufferSource();
    src.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(filter); filter.connect(g); g.connect(master);
    src.start(t0);
  }

  const SCALE = [523.25, 587.33, 659.25, 698.46, 783.99, 880.0, 987.77, 1046.5]; // C major

  /** Rising two-note chime; the pitch climbs with the combo, up to an octave. */
  function correct(combo = 0) {
    const step = Math.min(SCALE.length - 1, Math.floor((combo ?? 0) / 3));
    const root = SCALE[step];
    tone({ freq: root, duration: 0.09, type: "triangle", gain: 0.9 });
    tone({ freq: root * 1.5, duration: 0.16, type: "triangle", gain: 0.7, delay: 0.07 });
  }

  /** Gentle descending "not quite" — informative, not punishing. */
  function wrong() {
    tone({ freq: 311.13, duration: 0.13, type: "sine", gain: 0.8 });
    tone({ freq: 233.08, duration: 0.22, type: "sine", gain: 0.7, delay: 0.11 });
  }

  /** A soft tick for selecting a tile or option. */
  function tap() {
    tone({ freq: 880, duration: 0.035, type: "sine", gain: 0.35 });
  }

  /** Whoosh when a word tile lands in the answer line. */
  function place() {
    noise({ duration: 0.05, gain: 0.28, freq: 1600 });
  }

  /** Pluck when a pair matches. */
  function match() {
    tone({ freq: 1046.5, duration: 0.07, type: "triangle", gain: 0.5 });
  }

  /** Bright four-note fanfare for finishing a lesson. */
  function complete() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone({ freq: f, duration: 0.18, type: "triangle", gain: 0.8, delay: i * 0.1 }));
  }

  /** Warmer, longer motif when the lesson is perfect. */
  function perfect() {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
      tone({ freq: f, duration: 0.26, type: "triangle", gain: 0.85, delay: i * 0.11 }));
    tone({ freq: 1567.98, duration: 0.5, type: "sine", gain: 0.5, delay: 0.58 });
  }

  /** Low, slow pair for running out of hearts. */
  function fail() {
    tone({ freq: 196, duration: 0.26, type: "sine", gain: 0.8 });
    tone({ freq: 155.56, duration: 0.42, type: "sine", gain: 0.75, delay: 0.2 });
  }

  /** Coin-like chime for gems and rewards. */
  function reward() {
    tone({ freq: 987.77, duration: 0.07, type: "square", gain: 0.35 });
    tone({ freq: 1318.5, duration: 0.2, type: "square", gain: 0.3, delay: 0.06 });
  }

  /** Little ascending run when a skill levels up. */
  function levelUp() {
    [392, 523.25, 659.25, 783.99].forEach((f, i) =>
      tone({ freq: f, duration: 0.14, type: "triangle", gain: 0.7, delay: i * 0.08 }));
  }

  /** Metallic tink for unlocking an achievement. */
  function achievement() {
    tone({ freq: 1174.66, duration: 0.1, type: "sine", gain: 0.5 });
    tone({ freq: 1567.98, duration: 0.28, type: "sine", gain: 0.45, delay: 0.09 });
  }

  /** Rising sweep to open a new question. */
  function whoosh(up = true) {
    noise({ duration: 0.09, gain: 0.18, freq: up ? 1200 : 800 });
    tone({ freq: up ? 440 : 660, sweepTo: up ? 660 : 440, duration: 0.1, type: "sine", gain: 0.18 });
  }

  /** The names the client can call; keeps the surface explicit and testable. */
  const sounds = {
    correct, wrong, tap, place, match, complete, perfect, fail, reward, levelUp,
    achievement, whoosh,
  };

  return { ...sounds, setEnabled, unlock, get enabled() { return enabled; } };
})();

// Export for the module-style script; also attach for quick console testing.
export { Sound };
if (typeof window !== "undefined") window.ParrotoSound = Sound;
