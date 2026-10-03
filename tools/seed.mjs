/**
 * Parroto — demo seeder.
 *
 * Creates a demo account with realistic progress so the app has something to show on first
 * run: a streak, a few crowns, a partly-learned vocabulary and some due reviews.
 *
 *   node tools/seed.mjs            create/refresh the demo account
 *   node tools/seed.mjs --reset    wipe the database first
 *   node tools/seed.mjs --days 5   span the progress over 5 days (for a live streak)
 *
 * The app modules are imported dynamically, after the Node-compatibility check. A static
 * `import` would be hoisted and resolved before that check could run, which breaks Node
 * 22.5–23.x where node:sqlite needs --experimental-sqlite.
 */

import { spawnSync } from "node:child_process";
import { rmSync, existsSync } from "node:fs";

// ---------------------------------------------------------------- preflight

const FLAG = "--experimental-sqlite";

function sqliteWorks(extra = []) {
  return spawnSync(
    process.execPath,
    [...process.execArgv, ...extra, "-e", "require('node:sqlite')"],
    { stdio: "ignore" },
  ).status === 0;
}

if (!sqliteWorks()) {
  if (sqliteWorks([FLAG])) {
    const child = spawnSync(
      process.execPath,
      [FLAG, ...process.execArgv, process.argv[1], ...process.argv.slice(2)],
      { stdio: "inherit" },
    );
    process.exit(child.status ?? 0);
  }
  console.error("");
  console.error("❌  Parroto's seeder needs Node's built-in SQLite (node:sqlite).");
  console.error(`    Running Node ${process.versions.node}; node:sqlite needs Node 22.5+.`);
  console.error("    Run `npm run doctor` for details.");
  console.error("");
  process.exit(1);
}

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);
const reset = args.includes("--reset");
const daysIdx = args.indexOf("--days");
const days = daysIdx >= 0 ? Number(args[daysIdx + 1]) || 1 : 1;

const DB_PATH = process.env.PARROTO_DB ?? "data/parroto.db";
const USERNAME = "demo";
const PASSWORD = "parroto123";

// Only now load the app modules, which touch node:sqlite.
const { openDatabase } = await import("../src/db.mjs");
const { Service } = await import("../src/service.mjs");
const { getCourse } = await import("../src/content/courses.mjs");
const { dayKey } = await import("../src/core/gamification.mjs");

if (reset) {
  const removed = [];
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = DB_PATH + suffix;
    if (!existsSync(f)) continue;
    try {
      rmSync(f);
      removed.push(f);
    } catch (err) {
      // Almost always because the server is running and holding the file open. Say so plainly
      // rather than dumping an EBUSY stack trace.
      console.error("");
      console.error(`❌  Cannot reset: ${f} is in use.`);
      console.error("    Stop the running server first (Ctrl-C in its terminal), then re-run.");
      console.error("");
      process.exit(1);
    }
  }
  if (removed.length) console.log(`reset: removed ${removed.length} file(s)`);
}

const db = openDatabase(DB_PATH);
const service = new Service(db);

// ---- account
let user;
try {
  user = service.register({ username: USERNAME, password: PASSWORD, displayName: "Demo Learner" });
  console.log(`created account ${USERNAME} (password: ${PASSWORD})`);
} catch (err) {
  if (err.code !== "username_taken") throw err;
  user = service.publicUser(service.authenticate(USERNAME, PASSWORD));
  console.log(`account ${USERNAME} already exists — refreshing progress`);
  service.resetCourse(user.id, "es-en");
}

// Give some spending money so the shop and streak freezes are explorable.
service.awardGems(user.id, 500, "seed");

// ---- play a few lessons across several days
const courseId = "es-en";
service.enrol(user.id, courseId);
const course = getCourse(courseId);

/**
 * Plays one lesson correctly against the raw exercise queue. The demo account should look
 * like a real learner's, so this drives the same service calls the client does.
 */
function playLesson(skillId, kind, day) {
  const session = service.startSession(user.id, { courseId, skillId, kind, clientDay: day });
  const row = service.database.prepare("SELECT state FROM lesson_sessions WHERE id = ?").get(session.sessionId);
  const state = JSON.parse(row.state);
  let payload = null;
  for (const ex of [...state.exercises]) {
    const current = JSON.parse(service.database.prepare(
      "SELECT state FROM lesson_sessions WHERE id = ?").get(session.sessionId).state);
    const pending = current.exercises[current.exerciseIndex];
    if (!pending) break;
    payload = service.answer(user.id, session.sessionId, {
      exerciseId: pending.id, answer: solution(pending), clientDay: day,
    });
    if (payload.finished) break;
  }
  return payload;
}

/** The intended answer for a raw (un-stripped) exercise. */
function solution(ex) {
  switch (ex.type) {
    case "match_pairs": return ex.pairs.map((p) => ({ id: p.id, correct: true }));
    case "select_image": return ex.choices.find((c) => c.correct)?.emoji;
    case "speak": return { transcript: ex.answer };
    case "story": return Object.fromEntries(ex.questions.map((q) => [q.id, q.answer]));
    default: return ex.answer;
  }
}

// Walk backwards from today so the streak is real.
let played = 0;
for (let d = days - 1; d >= 0; d--) {
  const day = dayKey(new Date(Date.now() - d * 86400000));

  // Top up hearts: the demo account should not be blocked mid-seed.
  service.database.prepare("UPDATE users SET hearts = 5, hearts_updated_at = ? WHERE id = ?")
    .run(Date.now(), user.id);

  // Pick the next skill that has levels left.
  const state = service.courseState(user.id, courseId);
  const target = state.skills.find((s) => s.lessonAvailable);
  if (!target) break;

  const levels = days > 1 ? 1 : 3;   // a single-day seed gets a few crowns to look lived-in
  for (let i = 0; i < levels; i++) {
    const progress = service.courseState(user.id, courseId);
    const next = progress.skills.find((s) => s.lessonAvailable);
    if (!next) break;
    const result = playLesson(next.id, "lesson", day);
    if (result?.summary?.passed) played++;
    service.database.prepare("UPDATE users SET hearts = 5, hearts_updated_at = ? WHERE id = ?")
      .run(Date.now(), user.id);
  }
}

// ---- a couple of practice sessions so there is review history
service.database.prepare("UPDATE users SET hearts = 5, hearts_updated_at = ? WHERE id = ?")
  .run(Date.now(), user.id);
playLesson("es-basics-1", "practice", dayKey(new Date()));

// ---- report
const final = service.getUser(user.id);
const state = service.courseState(user.id, courseId);
const publicUser = service.publicUser(final);

console.log("");
console.log("seeded:");
console.log(`  user      ${publicUser.username} / ${PASSWORD}`);
console.log(`  lessons   ${played} passed`);
console.log(`  xp        ${publicUser.xp}  (daily ${publicUser.dailyXp}/${publicUser.dailyGoal})`);
console.log(`  streak    ${publicUser.streak} day(s), longest ${publicUser.longestStreak}`);
console.log(`  crowns    ${state.crowns} / ${state.skills.length * 5}`);
console.log(`  words     ${state.totals.learned} learned of ${state.totals.items}`);
console.log(`  due       ${state.totals.due} for review`);
console.log(`  skills    ${state.skills.filter((s) => s.unlocked).length} unlocked, ` +
            `${state.skills.filter((s) => s.completed).length} mastered`);
console.log("");
console.log(`start the app:  npm start   →  http://localhost:5175`);
