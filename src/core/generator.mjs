/**
 * Parroto — exercise generation.
 *
 * Turns a vocabulary item + its skill context into a concrete, gradable exercise. This is
 * what makes every exercise type available for every item without hand-authoring thousands
 * of exercises: distractors are drawn from the other items in the same skill (so wrong
 * answers are plausible), and each type gets a stable, seedable shape.
 */

import { normalise, exercisePlanFor } from "./exercises.mjs";

/** Small deterministic PRNG so a given (item, type, seed) always builds the same exercise. */
function rngFor(...parts) {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return function next() {
    h ^= h << 13; h >>>= 0;
    h ^= h >> 17;
    h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
}

function pick(rng, arr, n, exclude = new Set()) {
  const pool = arr.filter((x) => !exclude.has(x));
  const out = [];
  const copy = [...pool];
  while (out.length < n && copy.length) {
    const i = Math.floor(rng() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}

function shuffle(rng, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Splits a sentence into word-bank tokens (keeping punctuation off the tiles). */
function bankTokens(sentence) {
  return String(sentence)
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/^[¿¡]+/, "").replace(/[.,;:?!]+$/, ""))
    .filter(Boolean);
}

/**
 * Builds one exercise.
 *
 * @param item      the vocabulary item ({ id, target, source, images, alternatives })
 * @param type      one of EXERCISE_TYPES
 * @param siblings  other items in the same skill, used for plausible distractors
 * @param opts      { seed, course, skillId, language }
 */
export function buildExercise(item, type, siblings = [], opts = {}) {
  const seed = opts.seed ?? 1;
  const rng = rngFor(item.id, type, seed);
  const target = item.target;
  const source = item.source;
  const accepted = [target, ...(item.alternatives ?? [])];

  const otherTargets = siblings.filter((s) => s.id !== item.id).map((s) => s.target);
  const otherSources = siblings.filter((s) => s.id !== item.id).map((s) => s.source);
  const withImages = siblings.filter((s) => s.id !== item.id && s.images?.length);

  const base = {
    id: `${item.id}:${type}:${seed}`,
    type,
    itemId: item.id,
    skillId: opts.skillId ?? item.skillId ?? null,
    prompt: "",
    directions: "",
  };

  switch (type) {
    // ---------------------------------------------------------------------
    case "select_translation": {
      // "Which one means X?" must offer answers in the language being learned, not more
      // English — otherwise the exercise is unanswerable.
      const wrong = pick(rng, otherTargets, 3);
      if (wrong.length < 3) return null;
      return {
        ...base,
        directions: `Which one means “${source}”?`,
        prompt: source,
        choices: shuffle(rng, [target, ...wrong]),
        answer: target,
      };
    }

    // ---------------------------------------------------------------------
    case "select_image": {
      if (!item.images?.length) return null;
      const wrong = pick(rng, withImages, 3);
      if (wrong.length < 2) return null;
      return {
        ...base,
        directions: `Which image shows “${target}”?`,
        prompt: target,
        choices: shuffle(rng, [
          { id: item.id, emoji: item.images[0], label: item.source, correct: true },
          ...wrong.map((w) => ({ id: w.id, emoji: w.images[0], label: w.source, correct: false })),
        ]),
        answer: item.images[0],
      };
    }

    // ---------------------------------------------------------------------
    case "listen_select": {
      const wrong = pick(rng, otherTargets, 3);
      if (wrong.length < 3) return null;
      return {
        ...base,
        directions: "Tap what you hear",
        audio: { text: target, lang: opts.tts ?? "es-ES" },
        choices: shuffle(rng, [target, ...wrong]),
        answer: target,
      };
    }

    // ---------------------------------------------------------------------
    case "listen_type": {
      return {
        ...base,
        directions: "Type what you hear",
        audio: { text: target, lang: opts.tts ?? "es-ES" },
        answer: target,
        accepted,
        sourceHint: source,
      };
    }

    // ---------------------------------------------------------------------
    case "translate": {
      return {
        ...base,
        directions: `Translate into ${opts.toName ?? "the language you are learning"}`,
        prompt: source,
        answer: target,
        accepted,
        images: item.images ?? [],
      };
    }

    // ---------------------------------------------------------------------
    case "word_bank": {
      const words = bankTokens(target);
      if (words.length < 2) return null;
      const extra = bankTokens(pick(rng, otherTargets, 2).join(" "));
      const bank = shuffle(rng, [...words, ...pick(rng, extra, Math.min(2, extra.length))]);
      return {
        ...base,
        directions: "Write this in the language you are learning",
        prompt: source,
        bank,
        answer: words,
        accepted: accepted.map(bankTokens),
      };
    }

    // ---------------------------------------------------------------------
    case "order_words": {
      const words = bankTokens(target);
      if (words.length < 3) return null;
      // Scrambled with two decoy tokens so the puzzle is not trivially "put it back".
      const decoys = siblings
        .filter((s) => s.id !== item.id)
        .flatMap((s) => bankTokens(s.target))
        .filter((w) => !words.some((x) => normalise(x) === normalise(w)))
        .slice(0, 6);
      const bank = shuffle(rng, [...words, ...pick(rng, decoys, Math.min(2, decoys.length))]);
      return {
        ...base,
        directions: "Put the words in the right order",
        prompt: source,
        bank,
        answer: words,
        accepted: accepted.map(bankTokens).filter((t) => t.length > 0),
      };
    }

    // ---------------------------------------------------------------------
    case "fill_blank": {
      const words = bankTokens(target);
      if (words.length < 2) return null;
      // Blank out a content word rather than a function word, so the exercise is meaningful.
      // Function words (articles, pronouns, prepositions, conjunctions) are what a learner
      // guesses from context — blanking one tests nothing.
      const FUNCTION_WORDS = new Set([
        "el", "la", "los", "las", "un", "una", "unos", "unas",
        "le", "les", "du", "de", "des", "der", "die", "das", "dem", "den",
        "il", "lo", "gli", "i", "l", "la",
        "yo", "tu", "tú", "il", "elle", "on", "nous", "vous", "ils",
        "ich", "du", "er", "sie", "es", "wir",
        "io", "lui", "lei", "noi", "voi",
        "y", "e", "et", "und", "o", "ou", "oder", "a", "à", "an", "en",
        "mi", "mis", "mon", "ma", "mes", "mein", "meine", "mio", "mia",
        "que", "qué", "qui", "was", "che", "cual", "cuál",
        "es", "est", "está", "esta", "son", "sont", "ist", "sind", "soy",
        "no", "not", "nicht", "pas", "se", "si", "sí",
      ]);
      let blankIdx = words.findIndex((w) => !FUNCTION_WORDS.has(normalise(w)) && normalise(w).length > 2);
      if (blankIdx < 0) blankIdx = words.reduce(
        (best, w, i) => (normalise(w).length > normalise(words[best]).length ? i : best), 0);

      const hidden = words[blankIdx];
      const shown = words.map((w, i) => (i === blankIdx ? "___" : w));
      const wrong = pick(rng, otherTargets.map((t) => bankTokens(t)[0]).filter(Boolean), 3,
                         new Set([normalise(hidden)]));
      const choices = shuffle(rng, [hidden, ...wrong]);

      return {
        ...base,
        directions: `Fill in the blank`,
        prompt: source,
        sentence: shown.join(" "),
        blankIndex: blankIdx,
        choices,
        answer: hidden,
        fullAnswer: words.join(" "),
      };
    }

    // ---------------------------------------------------------------------
    case "match_pairs": {
      // A board of 4 pairs: this item plus 3 siblings, all tapped to connect.
      const others = pick(rng, siblings.filter((s) => s.id !== item.id), 3);
      if (others.length < 3) return null;
      const pairs = [item, ...others].map((it) => ({
        id: it.id,
        left: it.source,
        right: it.target,
      }));
      return {
        ...base,
        directions: "Tap the matching pairs",
        pairs,
        left: shuffle(rng, pairs.map((p) => ({ id: p.id, text: p.left }))),
        right: shuffle(rng, pairs.map((p) => ({ id: p.id, text: p.right }))),
        answer: pairs.length,
      };
    }

    // ---------------------------------------------------------------------
    case "speak": {
      return {
        ...base,
        directions: `Say “${source}”`,
        prompt: source,
        answer: target,
        accepted,
        tts: opts.tts ?? "es-ES",
      };
    }

    // ---------------------------------------------------------------------
    case "identify_character": {
      // Alphabet drill: pronounce one character of the word and ask which character it was.
      // Distractors come from the letters of the other items in the skill.
      const chars = [...target.replace(/[^\p{L}]/gu, "")];
      if (chars.length === 0) return null;
      const ch = chars[Math.floor(rng() * chars.length)];
      const pool = [...new Set(
        siblings.flatMap((s) => [...String(s.target).replace(/[^\p{L}]/gu, "")]),
      )].filter((c) => c.toLowerCase() !== ch.toLowerCase());
      const wrong = pick(rng, pool, 3);
      if (wrong.length < 3) return null;
      return {
        ...base,
        directions: "Which letter do you hear?",
        audio: { text: ch, lang: opts.tts ?? "es-ES", spell: true },
        choices: shuffle(rng, [ch, ...wrong]),
        answer: ch,
      };
    }

    default:
      return null;
  }
}

/**
 * Builds a whole lesson: one exercise per planned type for each item, capped to a sensible
 * session length, ordered recognition-first so the learner sees a word before producing it.
 */
export function buildLesson(items, opts = {}) {
  const { size = 8, seed = 1, speaking = true, siblings } = opts;
  const exercises = [];
  for (const item of items) {
    const plan = exercisePlanFor(item, { speaking });
    const pool = siblings ?? items;
    for (const type of plan) {
      const ex = buildExercise(item, type, pool, opts);
      if (ex) exercises.push(ex);
    }
  }
  // Interleave so consecutive exercises are not all the same type for the same word.
  const byItem = new Map();
  for (const ex of exercises) {
    if (!byItem.has(ex.itemId)) byItem.set(ex.itemId, []);
    byItem.get(ex.itemId).push(ex);
  }
  const rng = rngFor("lesson", seed, size);
  const interleaved = [];
  const buckets = shuffle(rng, [...byItem.values()]);
  let more = true;
  let round = 0;
  while (more) {
    more = false;
    for (const b of buckets) {
      if (b[round]) {
        interleaved.push(b[round]);
        more = true;
      }
    }
    round++;
  }

  // Prefer variety: pick greedily so a session shows as many *different* exercise types as
  // possible, rather than eight variants of the same two drills. Each type is still capped so
  // a session is not all multiple-choice.
  const maxPerType = Math.max(2, Math.ceil(size / 3));
  const chosen = [];
  const perType = new Map();
  const remaining = [...interleaved];
  while (chosen.length < size && remaining.length) {
    // Choose the candidate whose type is currently least represented.
    let bestIdx = -1;
    let bestCount = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const used = perType.get(remaining[i].type) ?? 0;
      if (used >= maxPerType) continue;
      if (used < bestCount) { bestCount = used; bestIdx = i; }
    }
    if (bestIdx < 0) break;   // every remaining type has hit its cap
    const [picked] = remaining.splice(bestIdx, 1);
    perType.set(picked.type, (perType.get(picked.type) ?? 0) + 1);
    chosen.push(picked);
  }
  return chosen.slice(0, size).map((ex, i) => ({ ...ex, order: i }));
}

export { bankTokens, pick, shuffle };
