/**
 * Parroto — feature audit.
 *
 * Answers "does every course actually get this feature?" with evidence, rather than by reading
 * the code and assuming. Checks, per course: every exercise type is reachable, speaking is
 * offered, hints exist, and the forgiving grader applies.
 *
 *   npm run audit
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
  console.error("❌  needs Node 22.5+ (node:sqlite). Run `npm run doctor`.");
  process.exit(1);
}

const { openDatabase } = await import("../src/db.mjs");
const { Service } = await import("../src/service.mjs");
const { COURSES, allItems, getCourse } = await import("../src/content/courses.mjs");
const { EXERCISE_TYPES } = await import("../src/core/exercises.mjs");
const { hintsFor } = await import("../src/core/hints.mjs");
const { buildExercise, buildLesson } = await import("../src/core/generator.mjs");

const service = new Service(openDatabase(":memory:"));

/** Which exercise types a course can actually produce, with hints, from its own content. */
function auditCourse(course) {
  const produced = new Map();     // type -> { count, hints, revealsAnswer }
  for (const skill of course.skills) {
    const items = skill.items.map((i) => ({ ...i, skillId: skill.id }));
    for (const item of items) {
      const lesson = buildLesson(items, { size: 12, seed: 3, speaking: true, tts: course.tts, toName: course.to, siblings: items });
      for (const ex of lesson) {
        const h = hintsFor(ex);
        const prev = produced.get(ex.type) ?? { count: 0, hasHints: false, reveals: false };
        produced.set(ex.type, {
          count: prev.count + 1,
          hasHints: prev.hasHints || h.length > 0,
          reveals: prev.reveals || h.some((x) => x.reveals),
        });
      }
    }
  }
  return produced;
}

const rows = [];
let failures = 0;

console.log("");
console.log("Parroto feature audit");
console.log("═".repeat(78));

for (const course of COURSES) {
  const produced = auditCourse(course);

  // Speaking must be offered by every course — the user asked for it in all languages.
  const speaks = produced.has("speak");
  // Every generated exercise must have a hint ladder.
  const noHints = [...produced.entries()].filter(([t, v]) => !v.hasHints).map(([t]) => t);
  const expected = EXERCISE_TYPES.filter((t) => t !== "story" && t !== "review_mistake");
  const missing = expected.filter((t) => !produced.has(t));

  const ok = speaks && noHints.length === 0 && missing.length === 0;
  if (!ok) failures++;

  console.log("");
  console.log(`${ok ? "✅" : "❌"} ${course.flag} ${course.name} (${course.id})`);
  console.log(`   exercise types reachable : ${produced.size}/${expected.length}${missing.length ? "  missing: " + missing.join(", ") : ""}`);
  console.log(`   speaking exercises       : ${speaks ? "yes" : "NO"}`);
  console.log(`   hints on every exercise  : ${noHints.length === 0 ? "yes" : "NO — " + noHints.join(", ")}`);
  console.log(`   types offering a reveal  : ${[...produced.entries()].filter(([, v]) => v.reveals).length}`);

  rows.push({ course: course.id, types: produced.size, speaks, noHints: noHints.length, missing: missing.length });
}

// ---- the forgiving grader, on real content from each course
console.log("");
console.log("Forgiving grader, per language (typo tolerance)");
console.log("─".repeat(78));
for (const course of COURSES) {
  const item = allItems(course).find((i) => String(i.target).split(" ").length === 1 && String(i.target).length >= 5);
  if (!item) { console.log(`   ${course.flag} ${course.name}: skipped (no suitable single word)`); continue; }
  const ex = buildExercise(item, "translate", allItems(course), { seed: 1, tts: course.tts, toName: course.to });
  const target = String(ex.answer);
  // a transposition: swap two middle characters
  const mangled = target.slice(0, 1) + target[2] + target[1] + target.slice(3);
  const { grade } = await import("../src/core/exercises.mjs");
  const r = grade(ex, mangled, { lang: course.tts.slice(0, 2) });
  console.log(`   ${course.flag} ${course.name.padEnd(10)} "${target}" + typo "${mangled}" -> ` +
              `${r.correct ? "accepted" : "REJECTED"} (${r.mistake ?? "-"})`);
  if (!r.correct) failures++;
}

// ---- speaking reachable through a real session, in every course
console.log("");
console.log("Speaking reachable through a real session");
console.log("─".repeat(78));
for (const course of COURSES) {
  const user = service.register({ username: `audit_${course.id.replace(/\W/g, "")}`, password: "secret123" });
  service.enrol(user.id, course.id);
  let found = false;
  for (const skill of course.skills.slice(0, 4)) {
    for (let attempt = 0; attempt < 5 && !found; attempt++) {
      const session = service.startSession(user.id, { courseId: course.id, skillId: skill.id, kind: "practice" });
      const state = JSON.parse(service.database.prepare(
        "SELECT state FROM lesson_sessions WHERE id = ?").get(session.sessionId).state);
      if (state.exercises.some((e) => e.type === "speak")) found = true;
      else break;
    }
    if (found) break;
  }
  console.log(`   ${course.flag} ${course.name.padEnd(10)} speaking served in a session: ${found ? "yes" : "NO"}`);
  if (!found) failures++;
}

console.log("");
console.log("═".repeat(78));
console.log(failures === 0 ? "✅ every course supports every advertised feature" : `❌ ${failures} problem(s)`);
console.log("");
process.exit(failures === 0 ? 0 : 1);
