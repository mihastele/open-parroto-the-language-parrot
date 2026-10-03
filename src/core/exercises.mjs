/**
 * Parroto — the exercise model.
 *
 * Every exercise type Duolingo supports, plus the grading rules for each. Keeping the
 * grading here (with no server or DOM dependencies) is what makes the whole app testable:
 * the same `grade()` the server calls is what the unit tests call.
 */

/** Every exercise kind the engine understands. */
export const EXERCISE_TYPES = [
  "translate",        // see a sentence, produce the translation (typed)
  "word_bank",        // assemble a sentence from scrambled tokens
  "select_image",     // pick the picture that matches the word
  "listen_select",    // hear the word, pick which one it was
  "listen_type",      // hear the sentence, type what you heard (dictation)
  "speak",            // say the sentence out loud; scored by a recogniser
  "match_pairs",      // tap pairs to match L1 <-> L2
  "fill_blank",       // complete the sentence with the right word
  "select_translation", // multiple-choice: which translation is correct?
  "order_words",      // put the words in the correct order
  "identify_character", // name the alphabet character
  "story",            // a dialogue with comprehension questions
  "review_mistake",   // re-serve a previously failed item
];

/** Types that are not gradable by string comparison (interactive / multi-part). */
const INTERACTIVE = new Set(["match_pairs", "select_image", "identify_character", "story"]);

export function isInteractive(type) {
  return INTERACTIVE.has(type);
}

/** Normalises text for comparison: case, whitespace, and common punctuation. */
export function normalise(text, { language = "es", keepAccents = true } = {}) {
  let s = String(text ?? "").trim().toLowerCase();
  // Collapse whitespace.
  s = s.replace(/\s+/g, " ");
  // Drop punctuation that never changes meaning, but keep apostrophes inside words.
  s = s.replace(/[¿?¡!.,;:"]/g, "");
  s = s.replace(/\s*'\s*/g, "'");
  if (!keepAccents) s = stripAccents(s);
  return s.trim();
}

export function stripAccents(s) {
  return String(s)
    // Letters NFD does not decompose into ASCII-able forms. Without these, "ich heiße" would
    // not match "ich heisse" and "bjørnen" would not match "bjornen" — a real gap for German
    // and the Nordic courses.
    .replace(/ß/g, "ss").replace(/ẞ/g, "SS")
    .replace(/ø/g, "o").replace(/Ø/g, "O")
    .replace(/æ/g, "ae").replace(/Æ/g, "AE")
    .replace(/œ/g, "oe").replace(/Œ/g, "OE")
    .replace(/å/g, "a").replace(/Å/g, "A")
    .replace(/đ/g, "d").replace(/ð/g, "d").replace(/þ/g, "th")
    .replace(/ł/g, "l").replace(/Ł/g, "L")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// ---------------------------------------------------------------------------
// Forgiving comparison
// ---------------------------------------------------------------------------

/**
 * Articles/particles that a learner routinely drops or adds. Ignoring these lets us accept
 * "quiero agua" for "yo quiero agua" without accepting genuinely wrong answers.
 */
const FILLER_WORDS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas",
  "le", "les", "du", "de", "des", "der", "die", "das",
  "il", "lo", "gli", "i", "l", "en", "ett",
  "yo", "jeg", "jag", "ich", "io", "je",
]);

/**
 * Words that reverse a sentence's meaning. Dropping one is never a "slight slip".
 */
const NEGATIONS = new Set([
  "no", "not", "nicht", "kein", "keine", "ne", "pas", "non",
  "inte", "ikke", "ej", "ni", "niet", "nu",
]);

/** Words so short that a single-character edit is meaningless. */
const MIN_TYPO_LENGTH = 4;

/** How many character-level mistakes a long answer may contain and still pass. */
const LONG_ANSWER_MIN_WORDS = 4;
const LONG_ANSWER_ERROR_RATE = 0.12;

/** Longest answer (in characters) still eligible for the fuzzy fallback. */
const LONG_ANSWER_MAX_CHARS = 80;

/** Levenshtein distance, used for "almost correct" typos. */
export function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/**
 * Damerau-Levenshtein distance: like Levenshtein but a swap of two adjacent characters
 * counts as ONE edit. This is the single most common typing error ("hte" for "the").
 */
export function editDistanceWithTransposition(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/** Similarity of two strings, 0..1, based on edit distance over the longer string. */
export function similarity(a, b) {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - editDistance(a, b) / longest;
}

/**
 * True when two strings differ only by one pair of adjacent characters being swapped.
 * This is the safest kind of "typo" to forgive: it cannot produce a different real word by
 * accident in the same way a substitution can ("gato" -> "pato").
 */
export function isTransposition(a, b) {
  if (a.length !== b.length) return false;
  const diff = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
  if (diff.length !== 2 || diff[1] !== diff[0] + 1) return false;
  const [i, j] = diff;
  return a[i] === b[j] && a[j] === b[i];
}

/**
 * Is a one-edit difference safe to forgive in this word?
 *
 * The kinds of edit are not equally risky:
 *  - A transposition (swapped neighbouring letters) is always safe.
 *  - An insertion/deletion rarely turns a word into a *different* real word, so it is forgiven
 *    on ordinary-length words ("hetr" for "heter").
 *  - A substitution is the risky one — that is exactly how you get "gato"/"pato" — so it is only
 *    forgiven on longer words, where it is far more likely to be a slip than a different word.
 */
function forgivingWordEdit(expected, given) {
  if (expected === given) return false;
  const d = editDistanceWithTransposition(expected, given);
  if (d > 1) return false;
  if (isTransposition(expected, given)) return true;
  const sameLength = expected.length === given.length;
  if (!sameLength) {
    // An insertion or deletion: judge by how long the *expected* word is. "hetr" for "heter"
    // drops a letter from a 5-letter word, which is a slip — not the learner choosing another
    // word. Comparing against the shorter string (4) rejected this case entirely.
    return expected.length >= 4;
  }
  return expected.length >= 6;   // substitution: riskier, so only on longer words
}

/**
 * Classifies how `given` differs from `expected`, returning null when they are equivalent.
 *
 * The order matters: unambiguous word-level categories first (a swap is definitely a swap),
 * then filler-word differences, then character-level typos last.
 */
export function classifyMistake(expected, given, lang = "es") {
  const na = normalise(expected, { language: lang });
  const ng = normalise(given, { language: lang });
  if (na === ng) return null;

  // Accents only.
  if (stripAccents(na) === stripAccents(ng)) return "accents";

  const aTokens = na.split(" ").filter(Boolean);
  const gTokens = ng.split(" ").filter(Boolean);

  // Two adjacent words swapped ("quiero yo" vs "yo quiero"). This must be checked BEFORE the
  // filler-word rule: "yo" is a filler, so dropping it would otherwise look like "extra_word".
  if (aTokens.length === gTokens.length && aTokens.length >= 2) {
    const diffs = [];
    for (let i = 0; i < aTokens.length; i++) if (aTokens[i] !== gTokens[i]) diffs.push(i);
    if (diffs.length === 2 && diffs[1] === diffs[0] + 1) {
      const [i, j] = diffs;
      if (aTokens[i] === gTokens[j] && aTokens[j] === gTokens[i]) return "word_swap";
    }
  }

  // Words in the right order but a stray article added or dropped.
  const aCore = aTokens.filter((t) => !FILLER_WORDS.has(t));
  const gCore = gTokens.filter((t) => !FILLER_WORDS.has(t));
  if (aCore.length > 0 && aCore.join(" ") === gCore.join(" ")) return "extra_word";

  // Same word count: one or two slightly-misspelled words.
  if (aTokens.length === gTokens.length && aTokens.length > 0) {
    const wrong = [];
    for (let i = 0; i < aTokens.length; i++) if (aTokens[i] !== gTokens[i]) wrong.push(i);
    if (wrong.length === 1) {
      const i = wrong[0];
      if (aTokens[i].length >= MIN_TYPO_LENGTH && forgivingWordEdit(aTokens[i], gTokens[i])) {
        return "typo";
      }
    }
    if (wrong.length === 2 && aTokens.length >= 4) {
      const bothClose = wrong.every((i) =>
        aTokens[i].length >= MIN_TYPO_LENGTH && forgivingWordEdit(aTokens[i], gTokens[i]));
      if (bothClose) return "typos";
    }
  }

  // A whole missing or extra word in a longer sentence. Negations are excluded, since dropping
  // "no"/"nicht"/"inte" reverses the meaning.
  if (aTokens.length >= 3 && Math.abs(aTokens.length - gTokens.length) === 1) {
    const shorter = aTokens.length < gTokens.length ? aTokens : gTokens;
    const longer = aTokens.length < gTokens.length ? gTokens : aTokens;
    const dropped = longer.find((t) => !shorter.includes(t));
    if (dropped && !NEGATIONS.has(dropped)) {
      for (let drop = 0; drop < longer.length; drop++) {
        const candidate = longer.slice(0, drop).concat(longer.slice(drop + 1));
        if (candidate.join(" ") === shorter.join(" ")) {
          return aTokens.length < gTokens.length ? "extra_word" : "missing_word";
        }
      }
    }
  }

  // Last resort for longer answers: a small overall character error.
  if (aTokens.length >= LONG_ANSWER_MIN_WORDS && na.length <= LONG_ANSWER_MAX_CHARS) {
    const allowed = Math.max(1, Math.floor(na.length * LONG_ANSWER_ERROR_RATE));
    if (editDistanceWithTransposition(na, ng) <= allowed) return "close";
  }

  return null;
}

/** True when a mistake category is worth a passing grade. */
function isForgiven(kind) {
  return kind === "accents" || kind === "extra_word" || kind === "word_swap"
      || kind === "typo" || kind === "typos" || kind === "missing_word" || kind === "close";
}

/** Grade to award for a forgiven mistake: milder kinds score higher. */
function gradeForMistake(kind) {
  switch (kind) {
    case "accents": return 2;
    case "extra_word": return 2;
    case "word_swap": return 1;
    case "missing_word": return 1;
    case "typo": return 1;
    case "typos": return 1;
    case "close": return 1;
    default: return 0;
  }
}

/** A short, specific explanation of what went wrong, and the corrected phrase. */
function feedbackForMistake(kind, expected) {
  switch (kind) {
    case "accents":
      return `Correct — mind the accents: ${expected}`;
    case "extra_word":
      return `Correct, but you added a word you don't need: ${expected}`;
    case "missing_word":
      return `Almost — you dropped a word. It's: ${expected}`;
    case "word_swap":
      return `Right words, wrong order. It's: ${expected}`;
    case "typo":
      return `One letter off — it's spelled: ${expected}`;
    case "typos":
      return `A couple of letters off — it's: ${expected}`;
    case "close":
      return `Very close! The exact answer is: ${expected}`;
    default:
      return `Not quite. The answer is: ${expected}`;
  }
}

/**
 * A word-by-word diff, so the client can show *where* the answer went wrong rather than just
 * "wrong". Returns one entry per expected token: ok | wrong | missing, plus any extras.
 */
export function diffWords(expected, given, lang = "es") {
  const a = normalise(expected, { language: lang }).split(" ").filter(Boolean);
  const g = normalise(given, { language: lang }).split(" ").filter(Boolean);
  const out = [];
  // Simple alignment: walk both, and once they diverge, resynchronise on the next match.
  let i = 0, j = 0;
  while (i < a.length) {
    if (j < g.length && a[i] === g[j]) {
      out.push({ expected: a[i], given: g[j], status: "ok" });
      i++; j++;
    } else {
      const ahead = g.indexOf(a[i], j);
      if (ahead > j) {
        // The learner has extra words before this one.
        for (let k = j; k < ahead; k++) out.push({ expected: null, given: g[k], status: "extra" });
        out.push({ expected: a[i], given: g[ahead], status: "ok" });
        j = ahead + 1; i++;
      } else {
        out.push({ expected: a[i], given: g[j] ?? null, status: g[j] ? "wrong" : "missing" });
        i++; if (j < g.length) j++;
      }
    }
  }
  while (j < g.length) { out.push({ expected: null, given: g[j], status: "extra" }); j++; }
  return out;
}

/**
 * Grades one answer.
 *
 * Returns { correct, grade, feedback, expected, nearMiss } where `grade` is the SM-2 style
 * quality used by the scheduler:
 *   0 = again (wrong), 1 = hard, 2 = good, 3 = easy
 */
export function grade(exercise, answer, opts = {}) {
  const type = exercise.type;

  switch (type) {
    case "translate":
    case "listen_type":
      return gradeText(exercise, answer, opts);

    case "word_bank":
    case "order_words":
      return gradeTokens(exercise, answer, opts);

    case "fill_blank":
      return gradeText(exercise, answer, opts);

    case "select_translation":
    case "listen_select":
      return gradeChoice(exercise, answer);

    case "select_image":
      return gradeChoice(exercise, answer);

    case "identify_character":
      return gradeChoice(exercise, answer);

    case "match_pairs":
      return gradeMatchPairs(exercise, answer);

    case "speak":
      return gradeSpeak(exercise, answer, opts);

    case "story":
      return gradeStory(exercise, answer);

    // A review exercise re-serves a previously failed item; it is graded exactly like the
    // exercise it wrapped, so the scheduler sees a normal verdict.
    case "review_mistake": {
      const inner = exercise.original ?? { ...exercise, type: exercise.originalType ?? "translate" };
      const r = grade(inner, answer, opts);
      return { ...r, wasReview: true };
    }

    default:
      return { correct: false, grade: 0, feedback: `Unsupported exercise type: ${type}` };
  }
}

// ---------------------------------------------------------------------------
// Graders
// ---------------------------------------------------------------------------

function acceptedAnswers(exercise) {
  const list = [];
  for (const key of ["answer", "answers", "accepted", "translation", "text"]) {
    const v = exercise[key];
    if (Array.isArray(v)) list.push(...v);
    else if (typeof v === "string") list.push(v);
  }
  return list.filter((x) => typeof x === "string" && x.length > 0);
}

function gradeText(exercise, answer, { lang = "es" } = {}) {
  const accepted = acceptedAnswers(exercise);
  if (accepted.length === 0) {
    return { correct: false, grade: 0, feedback: "This exercise has no answer defined." };
  }
  const given = String(answer ?? "");
  if (normalise(given, { language: lang }).length === 0) {
    return { correct: false, grade: 0, feedback: "No answer given.", expected: accepted[0] };
  }

  // Perfect answer: only case/punctuation differ.
  for (const a of accepted) {
    if (normalise(a, { language: lang }) === normalise(given, { language: lang })) {
      return { correct: true, grade: 3, expected: a, feedback: "Exactly right!" };
    }
  }

  // Otherwise work out *how* it differs, and be forgiving of the mistakes a learner actually
  // makes: dropped accents, a stray article, two words swapped, a typo or two.
  let best = null;
  for (const a of accepted) {
    const kind = classifyMistake(a, given, lang);
    if (!kind) continue;
    if (!isForgiven(kind)) continue;
    const grade = gradeForMistake(kind);
    if (!best || grade > best.grade) {
      best = {
        correct: true,
        grade,
        expected: a,
        mistake: kind,
        feedback: feedbackForMistake(kind, a),
        diff: diffWords(a, given, lang),
      };
    }
  }
  if (best) return best;

  // Genuinely wrong. Still say what the answer was.
  return {
    correct: false,
    grade: 0,
    expected: accepted[0],
    feedback: `Not quite. The answer is: ${accepted[0]}`,
    diff: diffWords(accepted[0], given, lang),
  };
}

export function tokensOf(x) {
  if (Array.isArray(x)) return x.map(String);
  if (typeof x === "string") return x.split(/\s+/).filter(Boolean);
  return [];
}

function gradeTokens(exercise, answer) {
  const given = tokensOf(answer);
  const accepted = [tokensOf(exercise.answer), tokensOf(exercise.accepted)]
    .filter((t) => t.length > 0);

  if (accepted.length === 0) {
    return { correct: false, grade: 0, feedback: "This exercise has no answer defined." };
  }
  if (given.length === 0) {
    return { correct: false, grade: 0, feedback: "Nothing selected.", expected: accepted[0].join(" ") };
  }

  // Exact order.
  for (const a of accepted) {
    if (a.length === given.length && a.every((t, i) => normalise(t) === normalise(given[i]))) {
      return { correct: true, grade: 3, expected: a.join(" ") };
    }
  }

  // Build-a-sentence exercises are about word ORDER, so be forgiving about the things that are
  // not really order mistakes: a typo in a typed word, or two neighbours the wrong way round.
  let best = null;
  for (const a of accepted) {
    const na = a.map((t) => normalise(t));
    const ng = given.map((t) => normalise(t));

    // Same words, one adjacent pair swapped.
    if (na.length === ng.length) {
      const diffs = [];
      for (let i = 0; i < na.length; i++) if (na[i] !== ng[i]) diffs.push(i);
      if (diffs.length === 2 && diffs[1] === diffs[0] + 1) {
        const [i, j] = diffs;
        if (na[i] === ng[j] && na[j] === ng[i]) {
          best = {
            correct: true, grade: 1, expected: a.join(" "), mistake: "word_swap",
            feedback: `Almost — those two are the other way round: ${a.join(" ")}`,
          };
          continue;
        }
      }

      // Same length but one word slightly misspelled (possible when typing a token).
      if (diffs.length === 1) {
        const i = diffs[0];
        if (na[i].length >= MIN_TYPO_LENGTH && forgivingWordEdit(na[i], ng[i])) {
          if (!best) {
            best = {
              correct: true, grade: 1, expected: a.join(" "), mistake: "typo",
              feedback: `Right order — one word is misspelled, it's: ${a.join(" ")}`,
            };
          }
        }
      }
    }

    // One missing or extra word, everything else in order.
    if (Math.abs(na.length - ng.length) === 1 && na.length >= 3) {
      const shorter = na.length < ng.length ? na : ng;
      const longer = na.length < ng.length ? ng : na;
      for (let drop = 0; drop < longer.length; drop++) {
        const candidate = longer.slice(0, drop).concat(longer.slice(drop + 1));
        if (candidate.join(" ") === shorter.join(" ")) {
          if (!best) {
            best = {
              correct: true, grade: 1, expected: a.join(" "),
              mistake: na.length < ng.length ? "extra_word" : "missing_word",
              feedback: na.length < ng.length
                ? `Almost — you added a word: ${a.join(" ")}`
                : `Almost — you dropped a word: ${a.join(" ")}`,
            };
          }
        }
      }
    }
  }
  if (best) return best;

  return {
    correct: false,
    grade: 0,
    expected: accepted[0].join(" "),
    feedback: `Correct order: ${accepted[0].join(" ")}`,
    // A failed order is most useful as a word-by-word comparison against what was built.
    diff: diffWords(accepted[0].join(" "), given.join(" ")),
  };
}

function gradeChoice(exercise, answer) {
  const given = String(answer ?? "").trim();
  const correct = Array.isArray(exercise.answer) ? exercise.answer : [exercise.answer];
  const ok = correct.some((c) => String(c).toLowerCase() === given.toLowerCase());
  if (ok) {
    return { correct: true, grade: 3, expected: String(correct[0] ?? ""), feedback: "Correct!" };
  }
  // Typing a fill-in-the-blank answer can be a letter off; a chosen tile cannot be.
  if (exercise.type === "fill_blank") {
    let best = null;
    for (const c of correct) {
      const kind = classifyMistake(String(c), given);
      if (kind && isForgiven(kind)) {
        const grade = gradeForMistake(kind);
        if (!best || grade > best.grade) {
          best = {
            correct: true, grade, expected: String(c), mistake: kind,
            feedback: feedbackForMistake(kind, String(c)),
          };
        }
      }
    }
    if (best) return best;
  }
  return {
    correct: false,
    grade: 0,
    expected: String(correct[0] ?? ""),
    feedback: `The answer is: ${correct[0]}`,
  };
}

/**
 * match_pairs is graded as a completed board: `answer` is the list of pairs the player
 * matched. Correct when every declared pair was matched without a wrong attempt.
 */
function gradeMatchPairs(exercise, answer) {
  const pairs = Array.isArray(exercise.pairs) ? exercise.pairs : [];
  const attempts = Array.isArray(answer) ? answer : [];
  const wrong = attempts.filter((a) => a && a.correct === false).length;
  const solved = attempts.filter((a) => a && a.correct === true).length;
  if (solved >= pairs.length && wrong === 0) {
    return { correct: true, grade: 3, feedback: "All pairs matched!" };
  }
  if (solved >= pairs.length) {
    return { correct: true, grade: 1, feedback: `All matched, with ${wrong} wrong attempt(s).` };
  }
  return { correct: false, grade: 0, feedback: `Matched ${solved}/${pairs.length} pairs.` };
}

/**
 * Speaking is graded on a transcript produced by the client (Web Speech API, or a mocked
 * recogniser in tests). Speech recognition is noisy, so this is deliberately the most forgiving
 * grader — but it still uses the same word-level analysis as typing, so "you said a different
 * word" and "the recogniser dropped a word" are distinguished rather than averaged together.
 */
function gradeSpeak(exercise, answer, opts = {}) {
  const transcript = typeof answer === "string" ? answer : answer?.transcript;
  const accepted = acceptedAnswers(exercise);
  if (!transcript || String(transcript).trim().length === 0) {
    return {
      correct: false,
      grade: 0,
      feedback: "Nothing heard. Check your microphone and try again.",
      expected: accepted[0],
    };
  }
  const heard = String(transcript);

  for (const a of accepted) {
    const na = normalise(a);
    const ng = normalise(heard);

    if (na === ng) {
      return { correct: true, grade: 3, feedback: "You said it!", heard };
    }
    if (stripAccents(na) === stripAccents(ng)) {
      return { correct: true, grade: 3, feedback: "You said it!", heard };
    }

    // Recognisers routinely drop or invent a short function word; that isn't a pronunciation
    // problem, so treat it as a near miss rather than a failure.
    const kind = classifyMistake(a, heard, opts.lang);
    if (kind === "extra_word" || kind === "accents") {
      return { correct: true, grade: 3, feedback: "You said it!", heard, mistake: kind };
    }
    if (kind === "word_swap" || kind === "missing_word" || kind === "typo" ||
        kind === "typos" || kind === "close") {
      return { correct: true, grade: 2, feedback: "Good — close enough.", heard, mistake: kind };
    }

    // Fall back to word-level overlap: if most of the words were recognised, accept it. Speech
    // recognition on longer sentences is patchy, and punishing that teaches nothing.
    const want = na.split(" ").filter(Boolean);
    const got = new Set(ng.split(" ").filter(Boolean));
    const matched = want.filter((w) => got.has(w) || got.has(stripAccents(w))).length;
    if (want.length >= 3 && matched / want.length >= 0.7) {
      return {
        correct: true, grade: 2, heard, mistake: "close",
        feedback: `Good — we heard most of it (${matched}/${want.length} words).`,
      };
    }

    // Per-word near-match. A recogniser routinely mangles a short word ("agua" -> "aguaa"), and
    // that is not a pronunciation mistake, so for SPEECH a one-edit difference is accepted on
    // any word length — unlike typing, where the same latitude would accept a different word.
    if (want.length === ng.split(" ").filter(Boolean).length && want.length > 0) {
      const gotTokens = ng.split(" ").filter(Boolean);
      const closeEnough = want.every((w, i) =>
        w === gotTokens[i] ||
        stripAccents(w) === stripAccents(gotTokens[i]) ||
        editDistanceWithTransposition(w, gotTokens[i]) <= 1);
      if (closeEnough) {
        return {
          correct: true, grade: 2, heard, mistake: "close",
          feedback: "Good — the recogniser caught most of it.",
        };
      }
    }
  }

  return {
    correct: false,
    grade: 0,
    expected: accepted[0],
    heard,
    feedback: `We heard "${heard}". Try the sentence: ${accepted[0]}`,
    diff: diffWords(accepted[0], heard, opts.lang),
  };
}

/** A story is a sequence of comprehension questions; grade the ones answered. */
function gradeStory(exercise, answer) {
  const questions = Array.isArray(exercise.questions) ? exercise.questions : [];
  const given = answer && typeof answer === "object" ? answer : {};
  let right = 0;
  for (const q of questions) {
    const a = given[q.id];
    if (a != null && String(a).toLowerCase() === String(q.answer).toLowerCase()) right++;
  }
  const total = questions.length || 1;
  const correct = right === total;
  return {
    correct,
    grade: correct ? 3 : right > 0 ? 1 : 0,
    feedback: `${right}/${total} comprehension questions correct.`,
    answered: right,
    total,
  };
}

// ---------------------------------------------------------------------------
// Exercise construction from content items
// ---------------------------------------------------------------------------

/** Splits a phrase into word tokens, stripping leading/trailing punctuation. */
function wordTokens(sentence) {
  return String(sentence)
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/^[¿¡"'(]+/, "").replace(/[.,;:?!")']+$/, ""))
    .filter(Boolean);
}

/**
 * Which exercise types make sense for a given content item, in pedagogy order:
 * recognise first, then produce.
 *
 * Only types this item can actually support are listed, so a single word never gets a
 * sentence-level exercise it would have to decline. `buildExercise` still returns null for
 * types that need more siblings than the skill provides, and callers skip those.
 */
export function exercisePlanFor(item, opts = {}) {
  const plan = [];
  const hasImage = Array.isArray(item.images) && item.images.length > 0;
  const hasAudio = true; // every course has a TTS voice, so listening is always available
  // Count words the same way the builder does, so the plan never lists an exercise the
  // builder will refuse. Counting raw whitespace tokens miscounts a trailing "?" as a word.
  const tokenCount = wordTokens(item.target ?? "").length;
  const alphabetic = /[a-zA-ZÀ-ÿ]/.test(String(item.target ?? ""));

  // Recognition.
  plan.push("select_translation");
  if (hasAudio) plan.push("listen_select");
  if (hasImage) plan.push("select_image");
  if (alphabetic) plan.push("identify_character");

  // Production comes before the construction drills. A session is capped in length and the
  // picker prefers variety, so anything sitting at the end of the plan is the most likely to be
  // dropped — and dropping the production exercises is the wrong trade. Speaking in particular
  // was never selected in an 8-exercise session before this reordering.
  plan.push("translate");
  if (hasAudio) {
    plan.push("listen_type");
    if (opts.speaking !== false) plan.push("speak");
  }

  // Construction — needs a phrase, not a single word.
  if (tokenCount >= 2) {
    plan.push("word_bank");
    plan.push("fill_blank");
    plan.push("match_pairs");
  }
  if (tokenCount >= 3) {
    plan.push("order_words");
  }
  return plan;
}

export const TYPES = EXERCISE_TYPES;
