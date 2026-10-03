/**
 * Parroto — end-to-end check of the forgiving grader through the *service*, not just the core.
 *
 * The core grader is unit-tested; this confirms the answer actually travels through a real
 * session (generation → storage → grading → feedback payload) with the mistake intact.
 *
 *   node tools/verify-forgiving.mjs
 *
 * Loads the app modules dynamically after the Node-compatibility check, because a static import
 * would be hoisted and resolved before that check could run.
 */

import { spawnSync } from "node:child_process";

const FLAG = "--experimental-sqlite";
function sqliteWorks(extra = []) {
  return spawnSync(process.execPath,
    [...process.execArgv, ...extra, "-e", "require('node:sqlite')"], { stdio: "ignore" }).status === 0;
}
if (!sqliteWorks()) {
  if (!process.execArgv.includes(FLAG) && sqliteWorks([FLAG])) {
    const child = spawnSync(process.execPath,
      [FLAG, ...process.execArgv, process.argv[1], ...process.argv.slice(2)], { stdio: "inherit" });
    process.exit(child.status ?? 0);
  }
  console.error("❌  This tool needs Node's built-in SQLite (node:sqlite) — Node 22.5+.");
  console.error("    Run `npm run doctor` for details.");
  process.exit(1);
}

const { openDatabase } = await import("../src/db.mjs");
const { Service } = await import("../src/service.mjs");
const { getCourse } = await import("../src/content/courses.mjs");

/**
 * Finds a multiword translate exercise whose target contains a word long enough to typo.
 *
 * Returns `{ sessionId, exercise }`, or null. Multi-word translate items are not in every skill,
 * and a phrase made only of short words cannot carry a meaningful transposition, so this searches
 * across several courses.
 */
function findMultiwordTranslate(service, userId, { courses = ["sv-en", "es-en", "de-en", "nb-en"], minWordLength = 4 } = {}) {
  for (const courseId of courses) {
    const course = getCourse(courseId);
    for (const skill of course.skills) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const session = service.startSession(userId, { courseId, skillId: skill.id, kind: "practice" });
        const ex = playUntil(service, userId, session.sessionId, (e) =>
          e.type === "translate"
          && String(e.answer ?? "").split(" ").filter(Boolean).length >= 2
          && String(e.answer).split(" ").some((w) => w.replace(/[^\p{L}]/gu, "").length >= minWordLength));
        if (ex) return { sessionId: session.sessionId, exercise: ex, courseId };
      }
    }
  }
  return null;
}

function playUntil(service, userId, sessionId, predicate) {
  for (let guard = 0; guard < 40; guard++) {
    const state = JSON.parse(service.database.prepare(
      "SELECT state FROM lesson_sessions WHERE id = ?").get(sessionId).state);
    const ex = state.exercises[state.exerciseIndex];
    if (!ex) return null;
    if (predicate(ex)) return ex;
    const answer = defaultAnswer(ex);
    const r = service.answer(userId, sessionId, { exerciseId: ex.id, answer });
    if (r.finished) return null;
  }
  return null;
}

function defaultAnswer(ex) {
  switch (ex.type) {
    case "match_pairs": return ex.pairs.map((p) => ({ id: p.id, correct: true }));
    case "select_image": return ex.choices.find((c) => c.correct).emoji;
    case "speak": return { transcript: ex.answer };
    case "story": return Object.fromEntries(ex.questions.map((q) => [q.id, q.answer]));
    default: return ex.answer;
  }
}

// A fresh user each run: reusing one means SRS state changes what the session contains, and the
// tool would pass or fail depending on how many times it had been run before.
const { service } = (() => {
  const db = openDatabase(":memory:");
  return { service: new Service(db) };
})();

const user = service.register({
  username: `verifier${Date.now() % 100000}`,
  password: "secret123",
});
service.enrol(user.id, "sv-en");

const results = [];

// ---- 1. a word swap on a real generated sentence
{
  const found = findMultiwordTranslate(service, user.id);
  const { exercise: ex, sessionId } = found;
  const words = String(ex.answer).split(" ");
  const swapped = [words[1], words[0], ...words.slice(2)].join(" ");
  const r = service.answer(user.id, sessionId, { exerciseId: ex.id, answer: swapped });
  results.push({
    case: "word swap", expected: ex.answer, given: swapped,
    correct: r.result.correct, mistake: r.result.mistake, feedback: r.result.feedback,
  });
}

// ---- 2. a typo
{
  const found = findMultiwordTranslate(service, user.id);
  const { exercise: ex, sessionId } = found;
  const words = String(ex.answer).split(" ");

  // Pick the longest word and transpose two of its middle letters. Transposition is the safest
  // typo class, so this must always be forgiven. Guard against a no-op (a 2-letter word) by
  // falling back to swapping the two words, which is also a near miss.
  let typoed = null;
  const idx = words.reduce((best, w, i) => (w.length > words[best].length ? i : best), 0);
  const target = words[idx];
  if (target.length >= 4) {
    const swapped = target.slice(0, 1) + target.slice(2, 3) + target.slice(1, 2) + target.slice(3);
    if (swapped !== target) {
      typoed = [...words.slice(0, idx), swapped, ...words.slice(idx + 1)].join(" ");
    }
  }
  if (typoed === null) {
    throw new Error("expected a word long enough to typo in a multi-word phrase");
  }

  const r = service.answer(user.id, sessionId, { exerciseId: ex.id, answer: typoed });
  results.push({
    case: "typo", expected: ex.answer, given: typoed,
    correct: r.result.correct, mistake: r.result.mistake, feedback: r.result.feedback,
  });
}

// ---- 3. a genuinely wrong answer, which must fail and carry a diff
{
  const found = findMultiwordTranslate(service, user.id);
  const { exercise: ex, sessionId } = found;
  const r = service.answer(user.id, sessionId, { exerciseId: ex.id, answer: "helt fel svar" });
  results.push({
    case: "wrong", expected: ex.answer, given: "helt fel svar",
    correct: r.result.correct, mistake: r.result.mistake, feedback: r.result.feedback,
    diff: r.result.diff,
  });
}

// ---- 4. a hinted answer must not extend the combo
{
  const s = service.startSession(user.id, { courseId: "sv-en", skillId: "sv-basics-1", kind: "practice" });
  const state = JSON.parse(service.database.prepare(
    "SELECT state FROM lesson_sessions WHERE id = ?").get(s.sessionId).state);
  const ex = state.exercises[state.exerciseIndex];

  // Ask for the ladder, then take the LAST rung — the one that reveals the answer.
  const preview = service.hint(user.id, s.sessionId, { exerciseId: ex.id });
  const lastStep = preview.hints[preview.hints.length - 1].step;
  const hint = service.hint(user.id, s.sessionId, { exerciseId: ex.id, step: lastStep }).hint;

  const r = service.answer(user.id, s.sessionId, { exerciseId: ex.id, answer: defaultAnswer(ex) });
  results.push({
    case: "answer after a hint", hintText: hint?.text, spent: true,
    correct: r.result.correct, combo: r.combo, feedback: r.result.feedback,
  });
}

// ---- report
console.log("");
for (const r of results) {
  console.log(`── ${r.case}`);
  console.log(`   expected : ${r.expected ?? "(n/a)"}`);
  if (r.given) console.log(`   given    : ${r.given}`);
  if (r.hintText) console.log(`   hint     : ${r.hintText}`);
  console.log(`   verdict  : ${r.correct ? "CORRECT" : "WRONG"}${r.mistake ? `  [${r.mistake}]` : ""}`);
  if (r.combo !== undefined) console.log(`   combo    : ${r.combo}`);
  console.log(`   feedback : ${r.feedback}`);
  if (r.diff) console.log(`   diff     : ${JSON.stringify(r.diff)}`);
  console.log("");
}

const swapOk = results[0].correct && results[0].mistake === "word_swap";
const typoOk = results[1].correct && results[1].mistake === "typo";
const wrongOk = !results[2].correct && Array.isArray(results[2].diff) && results[2].diff.length > 0;
const hintOk = results[3].correct && results[3].combo === 0;

console.log(`word swap forgiven       : ${swapOk ? "yes" : "NO"}  (${results[0].mistake})`);
console.log(`typo forgiven            : ${typoOk ? "yes" : "NO"}  (${results[1].mistake})`);
console.log(`wrong answer fails + diff: ${wrongOk ? "yes" : "NO"}  (${results[2].diff?.length ?? 0} diff entries)`);
console.log(`hint breaks the combo    : ${hintOk ? "yes" : "NO"}  (combo ${results[3].combo})`);
console.log("");
console.log(swapOk && typoOk && wrongOk && hintOk ? "✅ all behaviours correct" : "❌ something is off");
process.exit(swapOk && typoOk && wrongOk && hintOk ? 0 : 1);
