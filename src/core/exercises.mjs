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
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

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
  const given = normalise(answer, { language: lang });
  const accepted = acceptedAnswers(exercise);
  if (accepted.length === 0) {
    return { correct: false, grade: 0, feedback: "This exercise has no answer defined." };
  }
  if (given.length === 0) {
    return { correct: false, grade: 0, feedback: "No answer given.", expected: accepted[0] };
  }

  // Correct as-is (with punctuation/case ignored).
  for (const a of accepted) {
    if (normalise(a, { language: lang }) === given) {
      return { correct: true, grade: 3, expected: a, feedback: "Exactly right!" };
    }
  }

  // Acceptable if you only missed accents — a real Duolingo behaviour.
  const givenNoAccents = stripAccents(given);
  for (const a of accepted) {
    if (stripAccents(normalise(a, { language: lang })) === givenNoAccents) {
      return {
        correct: true,
        grade: 2,
        expected: a,
        feedback: `Correct, but watch the accents: ${a}`,
      };
    }
  }

  // One-character typo in a single word is forgiven. Compare token by token so a long
  // sentence does not get a proportionally huge allowance.
  for (const a of accepted) {
    const na = normalise(a, { language: lang });
    if (na.length <= 3) continue;
    const aTokens = na.split(" ");
    const gTokens = given.split(" ");
    if (aTokens.length === gTokens.length) {
      const wrongTokens = aTokens.filter((t, i) => t !== gTokens[i]);
      if (wrongTokens.length === 1 && editDistance(wrongTokens[0], gTokens[aTokens.indexOf(wrongTokens[0])]) === 1) {
        return { correct: true, grade: 1, expected: a, feedback: `Close enough — it's "${a}".` };
      }
    } else if (aTokens.length === 1 && editDistance(na, given) === 1) {
      return { correct: true, grade: 1, expected: a, feedback: `Close enough — it's "${a}".` };
    }
  }

  return {
    correct: false,
    grade: 0,
    expected: accepted[0],
    feedback: `Not quite. The answer is: ${accepted[0]}`,
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

  for (const a of accepted) {
    if (a.length === given.length && a.every((t, i) => normalise(t) === normalise(given[i]))) {
      return { correct: true, grade: 3, expected: a.join(" ") };
    }
  }

  return {
    correct: false,
    grade: 0,
    expected: accepted[0].join(" "),
    feedback: `Correct order: ${accepted[0].join(" ")}`,
  };
}

function gradeChoice(exercise, answer) {
  const given = String(answer ?? "").trim();
  const correct = Array.isArray(exercise.answer) ? exercise.answer : [exercise.answer];
  const ok = correct.some((c) => String(c).toLowerCase() === given.toLowerCase());
  return {
    correct: ok,
    grade: ok ? 3 : 0,
    expected: String(correct[0] ?? ""),
    feedback: ok ? "Correct!" : `The answer is: ${correct[0]}`,
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
 * recogniser in tests). We compare it like a text answer but stay forgiving: speech
 * recognition is noisy, so a close transcript still counts.
 */
function gradeSpeak(exercise, answer, opts) {
  const transcript = typeof answer === "string" ? answer : answer?.transcript;
  if (!transcript) {
    return {
      correct: false,
      grade: 0,
      feedback: "Nothing heard. Check your microphone and try again.",
      expected: acceptedAnswers(exercise)[0],
    };
  }
  const accepted = acceptedAnswers(exercise);
  const given = normalise(transcript);
  for (const a of accepted) {
    const na = normalise(a);
    if (na === given || stripAccents(na) === stripAccents(given)) {
      return { correct: true, grade: 3, feedback: "You said it!", heard: transcript };
    }
    // Allow a word or two to be misheard.
    const words = na.split(" ");
    const tolerance = Math.max(1, Math.floor(words.length * 0.3));
    if (editDistance(na, given) <= tolerance) {
      return { correct: true, grade: 2, feedback: "Good — close enough.", heard: transcript };
    }
  }
  return {
    correct: false,
    grade: 0,
    expected: accepted[0],
    heard: transcript,
    feedback: `We heard "${transcript}". Try the sentence: ${accepted[0]}`,
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

  // Recognition — always available.
  plan.push("select_translation");
  if (hasAudio) plan.push("listen_select");
  if (hasImage) plan.push("select_image");
  if (alphabetic) plan.push("identify_character");

  // Construction — needs a phrase, not a single word.
  if (tokenCount >= 2) {
    plan.push("word_bank");
    plan.push("fill_blank");
    plan.push("match_pairs");
  }
  if (tokenCount >= 3) {
    plan.push("order_words");
  }

  // Production — always available; dictation and speaking need audio.
  plan.push("translate");
  if (hasAudio) {
    plan.push("listen_type");
    if (opts.speaking !== false) plan.push("speak");
  }
  return plan;
}

export const TYPES = EXERCISE_TYPES;
