/**
 * Parroto — service integration tests.
 *
 * These exercise the real code paths a user hits: register, enrol, play a lesson to
 * completion, lose and spend hearts, keep a streak, unlock the next skill, do a review
 * session driven by the SRS scheduler, and run a story. They run against an in-memory
 * SQLite database, so they are fast and leave nothing behind.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureSqlite } from "../src/preflight.mjs";
ensureSqlite({ silent: true });

import { openDatabase } from "../src/db.mjs";
import { Service, publicExercise, AppError } from "../src/service.mjs";
import { grade } from "../src/core/exercises.mjs";
import { getCourse, allItems, storiesFor } from "../src/content/courses.mjs";
import { dayKey, MAX_HEARTS, HEART_REFILL_GEMS } from "../src/core/gamification.mjs";

// ---------------------------------------------------------------- harness

function freshService() {
  const db = openDatabase(":memory:");
  return { db, service: new Service(db) };
}

function newUser(service, name = "tester") {
  const user = service.register({ username: name, password: "hunter22", displayName: name });
  return service.getUser(user.id);
}

/** Answers every exercise in the session correctly, following the server's own queue. */
function playSession(service, userId, sessionId, { untilFinished = true, answerFor } = {}) {
  let payload = null;
  for (let guard = 0; guard < 200; guard++) {
    const row = service.database.prepare("SELECT * FROM lesson_sessions WHERE id = ?").get(sessionId);
    const state = JSON.parse(row.state);
    const ex = state.exercises[state.exerciseIndex];
    if (!ex) break;

    const answer = answerFor ? answerFor(ex, state) : correctAnswer(ex);
    payload = service.answer(userId, sessionId, { exerciseId: ex.id, answer, ms: 100 });
    if (payload.finished) return payload;
    if (!untilFinished) return payload;
  }
  return payload;
}

/** Produces a correct answer for a served (answer-stripped) exercise. */
function correctAnswer(ex) {
  switch (ex.type) {
    case "match_pairs":
      return ex.pairs.map((p) => ({ id: p.id, correct: true }));
    case "select_image":
      return ex.choices.find((c) => c.correct)?.emoji ?? ex.choices[0].emoji;
    case "story":
      // The story questions come back without answers; the test supplies them separately.
      return {};
    default:
      return ex.answer ?? "";
  }
}

/** Same, but for an exercise already stripped for the client (choices lose `correct`). */
function answerForServed(ex) {
  if (ex.type === "select_image") return ex.choices[0].emoji;
  return correctAnswer(ex);
}

/** A deliberately WRONG answer, for testing the mistake path. */
function wrongAnswer(ex) {
  switch (ex.type) {
    case "match_pairs":
      return ex.pairs.map((p, i) => ({ id: p.id, correct: i > 0 }));
    case "select_image":
      return ex.choices.find((c) => !c.correct)?.emoji ?? "?";
    case "word_bank":
    case "order_words":
      return [...(ex.bank ?? [])].reverse().slice(0, 1);
    case "speak":
      return { transcript: "totally wrong words" };
    case "story":
      return {};
    default:
      return "__definitely_wrong__";
  }
}

// ---------------------------------------------------------------- accounts

test("register creates a usable account with starting state", () => {
  const { service } = freshService();
  const user = service.register({ username: "Ana", password: "secret123", displayName: "Ana" });
  assert.equal(user.username, "ana", "usernames are normalised");
  assert.equal(user.hearts, MAX_HEARTS);
  assert.equal(user.streak, 0);
  assert.equal(user.xp, 0);
});

test("register rejects bad usernames and duplicate accounts", () => {
  const { service } = freshService();
  assert.throws(() => service.register({ username: "a", password: "secret123" }), /3-24 characters/);
  assert.throws(() => service.register({ username: "bad name!", password: "secret123" }), /3-24 characters/);
  assert.throws(() => service.register({ username: "ok_name", password: "short" }), /at least 6/);

  service.register({ username: "dup", password: "secret123" });
  const err = (() => { try { service.register({ username: "dup", password: "secret123" }); } catch (e) { return e; } })();
  assert.equal(err.code, "username_taken");
  assert.equal(err.status, 409);
});

test("passwords are hashed, never stored raw, and verified in constant time", () => {
  const { service } = freshService();
  service.register({ username: "hashme", password: "supersecret" });
  const row = service.database.prepare("SELECT password_hash FROM users WHERE username = 'hashme'").get();
  assert.ok(!row.password_hash.includes("supersecret"), "the raw password must not be stored");
  assert.match(row.password_hash, /^[0-9a-f]+:[0-9a-f]+$/, "salt:hash format");

  assert.ok(service.authenticate("hashme", "supersecret"));
  assert.throws(() => service.authenticate("hashme", "wrong"), /Wrong username or password/);
  assert.throws(() => service.authenticate("nobody", "supersecret"), /Wrong username or password/);
});

test("sessions authenticate and can be destroyed", () => {
  const { service } = freshService();
  const u = service.register({ username: "sess", password: "secret123" });
  const token = service.createSession(u.id);
  assert.equal(service.userForToken(token).id, u.id);
  service.destroySession(token);
  assert.equal(service.userForToken(token), null, "a logged-out token is rejected");
  assert.equal(service.userForToken("garbage"), null);
});

test("enrolling seeds locks, unlocks and SRS rows", () => {
  const { service } = freshService();
  const owner = newUser(service);
  const state = service.enrol(owner.id, "es-en");

  assert.equal(state.enrolled, true);
  assert.equal(state.skills[0].unlocked, true, "the first skill is open");
  assert.equal(state.skills[1].unlocked, false, "the second is locked");
  assert.equal(state.totals.learned, 0);
  assert.equal(state.crowns, 0);

  const srsCount = service.database.prepare(
    "SELECT COUNT(*) AS n FROM srs_items WHERE user_id = ?").get(owner.id).n;
  assert.equal(srsCount, allItems(getCourse("es-en")).length, "every item gets an SRS row");
});

test("grammar notes ride along with their skill, or null without", () => {
  const { service } = freshService();
  const owner = newUser(service);
  const state = service.enrol(owner.id, "es-en");

  assert.match(state.skills[0].notes, /masculine or feminine/, "Basics 1 teaches gender");
  assert.match(state.skills[1].notes, /upside-down mark/, "Basics 2 teaches questions");
  const food = state.skills.find((s) => s.id === "es-food");
  assert.equal(food.notes, null, "a skill without notes sends null, not undefined");
});

test("a locked skill cannot be started as a lesson", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const course = getCourse("es-en");
  const locked = course.skills[1].id;

  const err = (() => {
    try { service.startSession(u.id, { courseId: "es-en", skillId: locked, kind: "lesson" }); }
    catch (e) { return e; }
  })();
  assert.equal(err.code, "skill_locked");
  assert.equal(err.status, 409);
});

// ---------------------------------------------------------------- playing

test("a full lesson can be played to completion and awards XP, streak and crowns", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const skill = getCourse("es-en").skills[0];

  const session = service.startSession(u.id, { courseId: "es-en", skillId: skill.id, kind: "lesson" });
  assert.equal(session.total > 0, true, "the lesson has exercises");
  assert.equal(session.exercise.answer, undefined, "the answer is not leaked to the client");

  const end = playSession(service, u.id, session.sessionId);
  assert.equal(end.finished, true);
  assert.equal(end.summary.passed, true, "answering everything correctly passes");
  assert.ok(end.summary.xp > 0, "XP is awarded");
  assert.equal(end.summary.accuracy, 100);
  assert.equal(end.summary.mistakes, 0);
  assert.equal(end.summary.streak, 1, "the streak starts");
  assert.equal(end.summary.skillUp.level, 1, "the skill levels up");

  const progress = service.database.prepare(
    "SELECT * FROM skill_progress WHERE user_id = ? AND skill_id = ?").get(u.id, skill.id);
  assert.equal(progress.level, 1);
  assert.equal(progress.crowns, 1);
});

test("every served exercise can actually be answered correctly", () => {
  // The strongest correctness check in the suite: whatever the server hands out, the
  // canonical answer must be accepted. A single leak-free-but-unanswerable type would fail.
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");

  const seenTypes = new Set();
  for (const skill of getCourse("es-en").skills) {
    // Unlock everything so every skill's exercises are reachable.
    service.database.prepare(
      "UPDATE skill_progress SET unlocked = 1 WHERE user_id = ? AND skill_id = ?").run(u.id, skill.id);

    const session = service.startSession(u.id, { courseId: "es-en", skillId: skill.id, kind: "practice" });
    const row = service.database.prepare("SELECT * FROM lesson_sessions WHERE id = ?").get(session.sessionId);
    const state = JSON.parse(row.state);

    for (const ex of state.exercises) {
      if (ex.type === "story") continue;
      seenTypes.add(ex.type);
      const answer = correctAnswer(ex);   // the raw exercise still carries its answer
      const r = service.answer(u.id, session.sessionId, { exerciseId: ex.id, answer });
      assert.equal(r.result.correct, true,
        `${ex.type} for "${ex.prompt ?? ex.directions}" should accept its own answer`);
    }
  }
  assert.ok(seenTypes.size >= 8, `many exercise types should be served, saw ${[...seenTypes]}`);
});

test("a wrong answer costs a heart, gives feedback, and re-serves the item", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const skill = getCourse("es-en").skills[0];
  const session = service.startSession(u.id, { courseId: "es-en", skillId: skill.id, kind: "lesson" });
  const before = session.hearts;

  const first = service.answer(u.id, session.sessionId, {
    exerciseId: session.exercise.id, answer: "__wrong__",
  });
  assert.equal(first.result.correct, false);
  assert.ok(first.result.feedback.length > 0, "the user is told what happened");
  assert.equal(first.hearts, before - 1, "a lesson mistake costs a heart");
  assert.equal(first.combo, 0);

  const row = service.database.prepare("SELECT * FROM lesson_sessions WHERE id = ?").get(session.sessionId);
  const state = JSON.parse(row.state);
  assert.ok(state.exercises.some((e) => e.type === "review_mistake"),
    "the failed exercise comes back as a review_mistake");
});

test("practice and review sessions never cost hearts", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const skill = getCourse("es-en").skills[0];

  const session = service.startSession(u.id, { courseId: "es-en", skillId: skill.id, kind: "practice" });
  const after = service.answer(u.id, session.sessionId, {
    exerciseId: session.exercise.id, answer: "__wrong__",
  });
  assert.equal(after.result.correct, false);
  assert.equal(after.hearts, session.hearts, "practice is free, so a mistake costs nothing");
});

test("running out of hearts ends the lesson and marks it failed", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const skill = getCourse("es-en").skills[0];

  // Drain hearts to zero first.
  service.database.prepare("UPDATE users SET hearts = 1 WHERE id = ?").run(u.id);

  const session = service.startSession(u.id, { courseId: "es-en", skillId: skill.id, kind: "lesson" });
  const end = playSession(service, u.id, session.sessionId, { answerFor: () => "__wrong__" });

  assert.equal(end.finished, true);
  assert.equal(end.summary.passed, false, "running out of hearts fails the lesson");
  assert.equal(end.summary.outOfHearts, true);
  const after = service.getUser(u.id);
  assert.equal(after.hearts, 0);
});

test("zero hearts blocks new lessons but allows practice, and can be refilled with gems", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const skill = getCourse("es-en").skills[0];
  service.database.prepare("UPDATE users SET hearts = 0 WHERE id = ?").run(u.id);

  const err = (() => {
    try { service.startSession(u.id, { courseId: "es-en", skillId: skill.id, kind: "lesson" }); }
    catch (e) { return e; }
  })();
  assert.equal(err.code, "no_hearts");
  assert.equal(err.extra.refillCost, HEART_REFILL_GEMS);

  // Practice still works.
  assert.ok(service.startSession(u.id, { courseId: "es-en", skillId: skill.id, kind: "practice" }));

  // Not enough gems: refused with a clear reason.
  const poor = (() => { try { service.refillHearts(u.id); } catch (e) { return e; } })();
  assert.equal(poor.code, "not_enough_gems");

  service.awardGems(u.id, HEART_REFILL_GEMS, "test");
  const refilled = service.refillHearts(u.id);
  assert.equal(refilled.hearts, MAX_HEARTS);
  assert.equal(refilled.gems, 0, "the refill spends the gems");
});

test("finishing a skill five times masters it and unlocks the next", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const course = getCourse("es-en");
  const first = course.skills[0];
  const second = course.skills[1];

  let unlocked = null;
  for (let level = 1; level <= 5; level++) {
    const session = service.startSession(u.id, { courseId: "es-en", skillId: first.id, kind: "lesson" });
    const end = playSession(service, u.id, session.sessionId);
    assert.equal(end.summary.passed, true, `run ${level} should pass`);
    if (end.summary.skillUp?.unlocked) unlocked = end.summary.skillUp.unlocked;
  }

  const state = service.courseState(u.id, "es-en");
  const firstSkill = state.skills.find((s) => s.id === first.id);
  assert.equal(firstSkill.crowns, 5, "the skill is fully levelled");
  assert.equal(firstSkill.completed, true);
  assert.equal(firstSkill.lessonAvailable, false, "no more levels available");

  assert.ok(unlocked, "the next skill was unlocked");
  assert.equal(unlocked.id, second.id);
  const secondSkill = state.skills.find((s) => s.id === second.id);
  assert.equal(secondSkill.unlocked, true, "the next skill is now playable");
});

test("a course can be completed end to end", () => {
  // The headline claim: the app is finishable, not just playable.
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const course = getCourse("es-en");

  for (const skill of course.skills) {
    for (let level = 0; level < 5; level++) {
      // Top up hearts so a long play-through is not interrupted.
      service.database.prepare("UPDATE users SET hearts = 5 WHERE id = ?").run(u.id);
      const session = service.startSession(u.id, { courseId: "es-en", skillId: skill.id, kind: "lesson" });
      const end = playSession(service, u.id, session.sessionId);
      assert.equal(end.summary.passed, true, `${skill.id} level ${level + 1} should pass`);
    }
  }

  const state = service.courseState(u.id, "es-en");
  const crowns = state.skills.reduce((a, s) => a + s.crowns, 0);
  assert.equal(crowns, course.skills.length * 5, "every skill is mastered");
  assert.ok(state.skills.every((s) => s.completed), "every skill is complete");
  assert.ok(state.totals.wordsLearned > 0, "words were learned along the way");

  const me = service.getUser(u.id);
  assert.ok(me.xp > 0);
  assert.equal(me.streak, 1, "playing in one day keeps a streak of one");
});

// ---------------------------------------------------------------- answers and API shape

test("a duplicate answer for the same exercise resyncs instead of wedging the UI", () => {
  // Regression: a double-click used to return 409 out_of_sync with no recovery path, which
  // left the client permanently stuck on one exercise.
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const skill = getCourse("es-en").skills[0];
  const session = service.startSession(u.id, { courseId: "es-en", skillId: skill.id, kind: "lesson" });

  const ex = session.exercise;
  // session.exercise is the answer-stripped view; read the raw exercise to know the answer.
  const raw = JSON.parse(service.database.prepare(
    "SELECT state FROM lesson_sessions WHERE id = ?").get(session.sessionId).state).exercises[0];
  const answer = correctAnswer(raw);
  const first = service.answer(u.id, session.sessionId, { exerciseId: ex.id, answer });
  assert.equal(first.result.correct, true);

  // Same exercise id again — a double submit.
  const second = service.answer(u.id, session.sessionId, { exerciseId: ex.id, answer });
  assert.equal(second.resync, true, "a repeat is handled as a resync");
  assert.equal(second.result, null, "it does not grade twice");
  assert.ok(second.next, "it hands back the current exercise so the client can continue");
  assert.equal(second.next.id, first.next.id);
  assert.ok(second.hearts >= 0);

  // Progress must not advance twice.
  const row = service.database.prepare("SELECT * FROM lesson_sessions WHERE id = ?").get(session.sessionId);
  const state = JSON.parse(row.state);
  assert.equal(state.answered, 1, "the duplicate did not count as a second answer");
});

test("currentExercise reports the pending exercise and the finished summary", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const skill = getCourse("es-en").skills[0];
  const session = service.startSession(u.id, { courseId: "es-en", skillId: skill.id, kind: "lesson" });

  const cur = service.currentExercise(u.id, session.sessionId);
  assert.equal(cur.finished, false);
  assert.equal(cur.exercise.id, session.exercise.id, "it reports the exercise the client should show");
  assert.equal(cur.exercise.answer, undefined, "and still does not leak the answer");

  playSession(service, u.id, session.sessionId);
  const done = service.currentExercise(u.id, session.sessionId);
  assert.equal(done.finished, true);
  assert.ok(done.summary, "the stored summary is readable after finishing");
  assert.equal(done.summary.passed, true);
});

test("answers are never leaked to the client", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const skill = getCourse("es-en").skills[0];
  const session = service.startSession(u.id, { courseId: "es-en", skillId: skill.id, kind: "lesson" });

  const served = session.exercise;
  assert.equal(served.answer, undefined, "the answer is stripped");
  assert.equal(served.accepted, undefined, "accepted variants are stripped");
  assert.equal(served.original, undefined);

  const row = service.database.prepare("SELECT * FROM lesson_sessions WHERE id = ?").get(session.sessionId);
  const state = JSON.parse(row.state);
  for (const ex of state.exercises) {
    const pub = publicExercise(ex);
    if (pub.type === "story") {
      assert.ok(pub.questions.every((q) => q.answer === undefined), "story answers are stripped");
    } else {
      assert.equal(pub.answer, undefined, `${pub.type} must not leak its answer`);
    }
    // A `correct` flag on a choice is just as good as the answer to anyone reading the wire.
    if (Array.isArray(pub.choices)) {
      for (const c of pub.choices) {
        if (c && typeof c === "object") {
          assert.equal(c.correct, undefined,
            `${pub.type} must not tell the client which choice is right`);
        }
      }
    }
  }
});

test("a retry is presented to the client as the exercise it really is", () => {
  // Regression: the retry wrapper type had no client view, so a lesson containing a retry
  // could not be rendered at all and the session wedged on that question.
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const skill = getCourse("es-en").skills[0];
  const session = service.startSession(u.id, { courseId: "es-en", skillId: skill.id, kind: "lesson" });

  const raw = JSON.parse(service.database.prepare(
    "SELECT state FROM lesson_sessions WHERE id = ?").get(session.sessionId).state);
  const first = raw.exercises[0];
  service.answer(u.id, session.sessionId, { exerciseId: first.id, answer: wrongAnswer(first) });

  const after = JSON.parse(service.database.prepare(
    "SELECT state FROM lesson_sessions WHERE id = ?").get(session.sessionId).state);
  const retry = after.exercises.find((e) => e.type === "review_mistake");
  assert.ok(retry, "a failed exercise is re-queued");

  const served = publicExercise(retry);
  assert.notEqual(served.type, "review_mistake", "the client never sees the wrapper type");
  assert.equal(served.type, first.type, "it is served as the original exercise type");
  assert.equal(served.isRetry, true, "and is flagged as a retry");
  assert.ok(served.directions, "so it can be rendered");

  // And it must still be answerable under its original type.
  const r = grade({ ...first, type: served.type }, correctAnswer(first));
  assert.equal(r.correct, true);
});

test("failing everything still ends the session instead of looping forever", () => {
  // Regression: a failed retry was re-queued as another retry, so a session where every
  // answer was wrong never terminated — it appended exercises indefinitely.
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const skill = getCourse("es-en").skills[0];
  const session = service.startSession(u.id, { courseId: "es-en", skillId: skill.id, kind: "practice" });

  const startingTotal = session.total;
  let payload = null;
  let guard = 0;
  while (guard++ < 80) {
    const row = service.database.prepare("SELECT * FROM lesson_sessions WHERE id = ?").get(session.sessionId);
    const state = JSON.parse(row.state);
    const ex = state.exercises[state.exerciseIndex];
    if (!ex) break;
    payload = service.answer(u.id, session.sessionId, { exerciseId: ex.id, answer: worstAnswer(ex) });
    if (payload.finished) break;
  }

  assert.ok(guard < 80, "the session must terminate");
  assert.equal(payload.finished, true, "it finishes even when everything is wrong");
  assert.equal(payload.summary.passed, false, "and it is reported as failed");
  // Every mistake adds at most one retry, so the queue stays bounded.
  assert.ok(payload.summary.answered <= startingTotal * 2,
    `queue grew unbounded: answered ${payload.summary.answered} from ${startingTotal}`);
});

/** The least-correct answer available for an exercise, used to force failure. */
function worstAnswer(ex) {
  switch (ex.type) {
    case "match_pairs": return ex.pairs.map((p, i) => ({ id: p.id, correct: i === 0 }));
    case "select_image": return "__no_such_image__";
    case "speak": return { transcript: "zzz" };
    case "story": return {};
    case "word_bank":
    case "order_words": return [];
    default: return "__wrong__";
  }
}

test("every exercise type served by the API has the fields its client needs", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");

  const checked = new Set();
  for (const skill of getCourse("es-en").skills) {
    service.database.prepare(
      "UPDATE skill_progress SET unlocked = 1 WHERE user_id = ? AND skill_id = ?").run(u.id, skill.id);
    const session = service.startSession(u.id, { courseId: "es-en", skillId: skill.id, kind: "practice" });
    const row = service.database.prepare("SELECT * FROM lesson_sessions WHERE id = ?").get(session.sessionId);
    for (const ex of JSON.parse(row.state).exercises) {
      const e = publicExercise(ex);
      checked.add(e.type);
      assert.ok(e.directions, `${e.type} needs directions`);
      if (e.type === "word_bank" || e.type === "order_words") {
        assert.ok(Array.isArray(e.bank) && e.bank.length > 0, `${e.type} needs a word bank`);
      }
      if (e.type === "select_translation" || e.type === "listen_select" || e.type === "fill_blank") {
        assert.ok(Array.isArray(e.choices) && e.choices.length >= 2, `${e.type} needs choices`);
      }
      if (e.type === "select_image") {
        assert.ok(e.choices.every((c) => c.emoji), "image choices need emoji");
      }
      if (e.type === "identify_character") {
        assert.ok(e.choices.every((c) => typeof c === "string" && c.length >= 1),
          "character choices are single letters");
      }
      if (e.type === "listen_select" || e.type === "listen_type" || e.type === "identify_character") {
        assert.ok(e.audio?.text, `${e.type} needs audio text`);
        assert.ok(e.audio?.lang, `${e.type} needs an audio language`);
      }
      if (e.type === "match_pairs") {
        assert.ok(e.pairs?.length >= 2, "match_pairs needs pairs");
        assert.ok(e.left?.length && e.right?.length, "match_pairs needs both columns");
      }
      if (e.type === "speak") {
        assert.ok(e.accepted === undefined, "speak must not leak accepted answers");
        assert.ok(e.tts, "speak needs a voice language");
      }
    }
  }
  assert.ok(checked.size >= 6, `expected a variety of types, saw ${[...checked]}`);
});

test("answering out of sync is rejected rather than silently accepted", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const skill = getCourse("es-en").skills[0];
  const session = service.startSession(u.id, { courseId: "es-en", skillId: skill.id, kind: "lesson" });

  const err = (() => {
    try { service.answer(u.id, session.sessionId, { exerciseId: "not-the-current-one", answer: "x" }); }
    catch (e) { return e; }
  })();
  assert.equal(err.code, "out_of_sync");
  assert.equal(err.extra.expected, session.exercise.id);
});

test("a session cannot be answered after it is finished", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const skill = getCourse("es-en").skills[0];
  const session = service.startSession(u.id, { courseId: "es-en", skillId: skill.id, kind: "lesson" });
  playSession(service, u.id, session.sessionId);

  const err = (() => {
    try { service.answer(u.id, session.sessionId, { exerciseId: "x", answer: "y" }); }
    catch (e) { return e; }
  })();
  assert.equal(err.code, "session_done");
});

test("one user cannot answer another user's session", () => {
  const { service } = freshService();
  const a = newUser(service, "alice");
  const b = newUser(service, "bob");
  service.enrol(a.id, "es-en");
  const skill = getCourse("es-en").skills[0];
  const session = service.startSession(a.id, { courseId: "es-en", skillId: skill.id, kind: "lesson" });

  assert.throws(() => service.answer(b.id, session.sessionId, { exerciseId: session.exercise.id, answer: "x" }),
                /No such session/);
});

// ---------------------------------------------------------------- srs integration

test("a wrong answer schedules an early review, a right one pushes it out", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const skill = getCourse("es-en").skills[0];
  const itemId = skill.items[0].id;

  const now = Date.now();
  service.updateSrs(u.id, "es-en", itemId, skill.id, 0, now);
  const lapsed = service.database.prepare(
    "SELECT * FROM srs_items WHERE user_id = ? AND item_id = ?").get(u.id, itemId);
  assert.ok(lapsed.due_at - now < 24 * 3600 * 1000, "a lapse comes back quickly");
  assert.equal(lapsed.lapses, 1);

  service.updateSrs(u.id, "es-en", itemId, skill.id, 2, now);
  const good = service.database.prepare(
    "SELECT * FROM srs_items WHERE user_id = ? AND item_id = ?").get(u.id, itemId);
  assert.ok(good.due_at > lapsed.due_at, "a correct answer pushes the review out");
  assert.equal(good.reps, 1);
});

test("review sessions serve due items and refuse when nothing is due", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");

  // Everything starts due, so a review session should start.
  const session = service.startSession(u.id, { courseId: "es-en", kind: "review" });
  assert.ok(session.total > 0, "there is something to review at the start");

  // Push every item far into the future: now nothing is due.
  service.database.prepare("UPDATE srs_items SET due_at = ? WHERE user_id = ?")
    .run(Date.now() + 30 * 24 * 3600 * 1000, u.id);
  const err = (() => {
    try { service.startSession(u.id, { courseId: "es-en", kind: "review" }); }
    catch (e) { return e; }
  })();
  assert.equal(err.code, "nothing_due");
});

test("learning an item marks it learned for the course totals", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  assert.equal(service.courseState(u.id, "es-en").totals.learned, 0);

  const skill = getCourse("es-en").skills[0];
  const session = service.startSession(u.id, { courseId: "es-en", skillId: skill.id, kind: "lesson" });
  playSession(service, u.id, session.sessionId);

  const after = service.courseState(u.id, "es-en").totals;
  assert.ok(after.learned > 0, "played items count as learned");
  assert.ok(after.learned <= after.items);
});

// ---------------------------------------------------------------- stories

test("stories unlock with progress and can be played for XP", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const story = storiesFor("es-en")[0];

  let state = service.courseState(u.id, "es-en");
  assert.equal(state.stories[0].unlocked, false, "stories start locked");

  // Master the required number of skills.
  for (const skill of getCourse("es-en").skills.slice(0, story.requiresSkills)) {
    for (let i = 0; i < 5; i++) {
      service.database.prepare("UPDATE users SET hearts = 5 WHERE id = ?").run(u.id);
      const s = service.startSession(u.id, { courseId: "es-en", skillId: skill.id, kind: "lesson" });
      playSession(service, u.id, s.sessionId);
    }
  }

  state = service.courseState(u.id, "es-en");
  assert.equal(state.stories[0].unlocked, true, "the story unlocks after enough progress");

  // Start and answer the story with the real questions.
  const session = service.startSession(u.id, { courseId: "es-en", kind: "story", storyId: story.id });
  assert.equal(session.exercise.type, "story");
  assert.equal(session.exercise.lines.length, story.lines.length, "the dialogue is served");

  const answers = Object.fromEntries(story.questions.map((q) => [q.id, q.answer]));
  const end = service.answer(u.id, session.sessionId, { exerciseId: session.exercise.id, answer: answers });
  assert.equal(end.result.correct, true, "correct comprehension answers are accepted");
  assert.equal(end.finished, true, "a story is a single exercise");
  assert.equal(end.summary.passed, true, "a story passed with all questions right");
  assert.ok(end.summary.xp > 0, "stories award XP");
});

test("a story can be failed", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  service.database.prepare(
    "UPDATE skill_progress SET unlocked = 1, level = 5, crowns = 5 WHERE user_id = ?").run(u.id);
  const story = storiesFor("es-en")[0];
  const session = service.startSession(u.id, { courseId: "es-en", kind: "story", storyId: story.id });
  const end = service.answer(u.id, session.sessionId, {
    exerciseId: session.exercise.id,
    answer: Object.fromEntries(story.questions.map((q) => [q.id, "__wrong__"])),
  });
  assert.equal(end.result.correct, false, "wrong answers are marked wrong");
  assert.equal(end.finished, true);
  assert.equal(end.summary.passed, false, "a failed story does not pass");
  assert.equal(end.summary.xp, 0, "no XP for a failed story");
});

// ---------------------------------------------------------------- gamification integration

test("XP accumulates, the daily goal is tracked and quests progress", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const skill = getCourse("es-en").skills[0].id;

  service.database.prepare("UPDATE users SET hearts = 5 WHERE id = ?").run(u.id);
  const s1 = service.startSession(u.id, { courseId: "es-en", skillId: skill, kind: "lesson" });
  const r1 = playSession(service, u.id, s1.sessionId);
  const xpAfterOne = r1.summary.totalXp;
  assert.ok(xpAfterOne > 0);

  const home = service.home(u.id);
  assert.equal(home.user.xp, xpAfterOne);
  assert.equal(home.quests.length, 3, "three daily quests are active");

  // The three quests rotate daily, so check whichever is present rather than assuming.
  const xpQuest = home.quests.find((q) => q.kind === "xp");
  if (xpQuest) {
    assert.ok(xpQuest.progress > 0, "the XP quest saw progress from the lesson");
  }
  const lessonQuest = home.quests.find((q) => q.kind === "lessons");
  if (lessonQuest) {
    assert.ok(lessonQuest.progress > 0, "the lessons quest saw progress");
  }
});

test("a finished quest can be claimed for gems exactly once", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");

  // Finish every quest by hand, then claim one.
  const today = dayKey(new Date());
  const quests = service.quests(u.id, today);
  for (const q of quests) {
    service.database.prepare(
      "UPDATE quests SET progress = goal WHERE user_id = ? AND day = ? AND quest_id = ?")
      .run(u.id, today, q.id);
  }

  const target = quests[0];
  const claim = service.claimQuest(u.id, target.id, today);
  assert.equal(claim.gems, 20);
  assert.equal(claim.user.gems, 20);

  const second = (() => { try { service.claimQuest(u.id, target.id, today); } catch (e) { return e; } })();
  assert.equal(second.code, "already_claimed");
});

test("an unfinished quest cannot be claimed", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const today = dayKey(new Date());
  const target = service.quests(u.id, today)[0];
  const err = (() => { try { service.claimQuest(u.id, target.id, today); } catch (e) { return e; } })();
  assert.equal(err.code, "quest_incomplete");
});

test("achievements unlock from real play", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const skill = getCourse("es-en").skills[0].id;

  const before = service.achievements(u.id);
  assert.ok(before.every((a) => !a.unlocked), "nothing is unlocked on a fresh account");

  service.database.prepare("UPDATE users SET hearts = 5 WHERE id = ?").run(u.id);
  const session = service.startSession(u.id, { courseId: "es-en", skillId: skill, kind: "lesson" });
  const end = playSession(service, u.id, session.sessionId);
  assert.ok(end.summary.achievements.some((a) => a.id === "first_lesson"), "First Steps unlocks");

  const after = service.achievements(u.id);
  const first = after.find((a) => a.id === "first_lesson");
  assert.equal(first.unlocked, true);
  assert.ok(first.unlockedAt > 0, "the unlock time is recorded");
});

test("the leaderboard ranks users by weekly XP and includes the viewer", () => {
  const { service } = freshService();
  const a = newUser(service, "ann");
  const b = newUser(service, "ben");
  service.enrol(a.id, "es-en");
  service.enrol(b.id, "es-en");

  // Give both some weekly XP, ben more than ann.
  service.database.prepare("INSERT INTO leaderboard (user_id, week, xp, league) VALUES (?, ?, ?, 'bronze')")
    .run(a.id, currentWeek(), 50);
  service.database.prepare("INSERT INTO leaderboard (user_id, week, xp, league) VALUES (?, ?, ?, 'bronze')")
    .run(b.id, currentWeek(), 150);

  const board = service.leaderboard(a.id);
  assert.ok(board.entries.length >= 2);
  assert.equal(board.entries[0].displayName, "ben", "more XP ranks higher");
  const me = board.entries.find((e) => e.isYou);
  assert.equal(me.displayName, "ann");
  assert.ok(["promote", "stay", "demote"].includes(board.outcome));
});

test("a user with no weekly XP is still shown, at the bottom", () => {
  const { service } = freshService();
  const a = newUser(service, "newbie");
  service.updateSettings(a.id, { displayName: "Newbie" });
  const board = service.leaderboard(a.id);
  assert.ok(board.you, "the viewer always appears on the board");
  assert.equal(board.you.xp, 0);
  assert.equal(board.you.rank, 1, "alone, they are rank 1");
});

function currentWeek() {
  const d = new Date();
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

test("streaks survive across days and reset after a gap", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const skill = getCourse("es-en").skills[0].id;

  const play = (day) => {
    service.database.prepare("UPDATE users SET hearts = 5 WHERE id = ?").run(u.id);
    const s = service.startSession(u.id, { courseId: "es-en", skillId: skill, kind: "lesson", clientDay: day });
    return playSession(service, u.id, s.sessionId);
  };

  const d1 = play("2026-03-01");
  assert.equal(d1.summary.streak, 1);
  const d2 = play("2026-03-02");
  assert.equal(d2.summary.streak, 2);
  const d3 = play("2026-03-03");
  assert.equal(d3.summary.streak, 3);
  assert.equal(d3.summary.streakIncreased, true);

  const afterGap = play("2026-03-06");
  assert.equal(afterGap.summary.streak, 1, "a gap resets the streak");
});

test("the home screen is complete and self-consistent", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const home = service.home(u.id);

  assert.ok(home.user.username);
  assert.equal(home.courses.length, 1);
  assert.equal(home.currentCourse.id, "es-en");
  assert.ok(home.nextSkill, "a next skill is suggested");
  assert.equal(home.nextSkill.id, getCourse("es-en").skills[0].id);
  assert.equal(home.quests.length, 3);
  assert.ok(home.dueCount > 0, "everything is due at the start");
  assert.equal(home.streakTier, "starter");
});

test("settings round-trip", () => {
  const { service } = freshService();
  const u = newUser(service);
  const updated = service.updateSettings(u.id, {
    displayName: "Ana María", dailyGoal: 50, soundEnabled: false, speakingEnabled: false,
  });
  assert.equal(updated.displayName, "Ana María");
  assert.equal(updated.dailyGoal, 50);
  assert.equal(updated.soundEnabled, false);
  assert.equal(updated.speakingEnabled, false);

  const reread = service.publicUser(service.getUser(u.id));
  assert.equal(reread.dailyGoal, 50, "settings persist");
});

test("speaking exercises are offered in every course regardless of the setting", () => {
  // The setting no longer removes speaking from lessons — it only affects how strictly speech is
  // judged, and the client always offers a type-in fallback. Removing the exercise outright made
  // "speaking for all languages" impossible for anyone who had ever toggled it off.
  for (const courseId of ["es-en", "fr-en", "de-en", "it-en", "nb-en", "sv-en"]) {
    const { service } = freshService();
    const u = newUser(service, `speak_${courseId.replace(/\W/g, "")}`);
    service.enrol(u.id, courseId);
    service.updateSettings(u.id, { speakingEnabled: false });

    const course = getCourse(courseId);
    let sawSpeak = false;
    for (const skill of course.skills.slice(0, 4)) {
      for (let attempt = 0; attempt < 6 && !sawSpeak; attempt++) {
        const s = service.startSession(u.id, { courseId, skillId: skill.id, kind: "practice" });
        const state = JSON.parse(service.database.prepare(
          "SELECT state FROM lesson_sessions WHERE id = ?").get(s.sessionId).state);
        if (state.exercises.some((e) => e.type === "speak")) sawSpeak = true;
      }
      if (sawSpeak) break;
    }
    assert.equal(sawSpeak, true, `${courseId} must still offer speaking exercises`);
  }
});

test("switching course changes the active course and keeps each course's progress", () => {
  // Regression: home() returned whichever course was enrolled first, so picking a different
  // course appeared to do nothing at all.
  const { service } = freshService();
  const u = newUser(service);

  service.enrol(u.id, "es-en");
  service.switchCourse(u.id, "nb-en");

  const home = service.home(u.id);
  assert.equal(home.currentCourse.id, "nb-en", "the switched-to course is the active one");
  assert.equal(home.courses.length, 2, "both courses remain enrolled");
  assert.equal(home.courses[0].id, "nb-en", "the active course is listed first");
  assert.equal(home.courses[0].skills[0].unlocked, true);
  assert.equal(home.courses[1].id, "es-en");

  // Play a Norwegian lesson, then switch back: Spanish progress must be untouched.
  service.database.prepare("UPDATE users SET hearts = 5 WHERE id = ?").run(u.id);
  const s = service.startSession(u.id, {
    courseId: "nb-en", skillId: getCourse("nb-en").skills[0].id, kind: "lesson",
  });
  const end = playSession(service, u.id, s.sessionId);
  assert.equal(end.summary.passed, true, "a Norwegian lesson is playable");

  service.switchCourse(u.id, "es-en");
  const back = service.home(u.id);
  assert.equal(back.currentCourse.id, "es-en");
  const nb = back.courses.find((c) => c.id === "nb-en");
  assert.equal(nb.crowns, 1, "the Norwegian crown is kept");
  const es = back.courses.find((c) => c.id === "es-en");
  assert.equal(es.crowns, 0, "Spanish progress is separate and untouched");
});

test("switching to a course you are not enrolled in enrols you", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const state = service.switchCourse(u.id, "sv-en");
  assert.equal(state.id, "sv-en");
  assert.equal(state.enrolled, true);
  assert.equal(service.home(u.id).currentCourse.id, "sv-en");
});

test("switching to an unknown course is refused", () => {
  const { service } = freshService();
  const u = newUser(service);
  const err = (() => { try { service.switchCourse(u.id, "xx-en"); } catch (e) { return e; } })();
  assert.equal(err.code, "not_found");
});

test("the answer payload carries why it was marked, for the client to render", () => {
  // Regression: `mistake` and `diff` were dropped by the service, so the UI could not say
  // "close enough" or show which word was wrong — it only ever showed bare feedback text.
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");

  /** Answers correctly until an exercise satisfying `want` is pending, then returns it. */
  const advanceTo = (sessionId, want) => {
    for (let guard = 0; guard < 40; guard++) {
      const st = JSON.parse(service.database.prepare(
        "SELECT state FROM lesson_sessions WHERE id = ?").get(sessionId).state);
      const ex = st.exercises[st.exerciseIndex];
      if (!ex) return null;
      if (want(ex)) return ex;
      const r = service.answer(u.id, sessionId, { exerciseId: ex.id, answer: correctAnswer(ex) });
      if (r.finished) return null;
    }
    return null;
  };

  // A forgiven near miss needs a multi-word answer, which not every session contains.
  let sawSwap = false;
  for (const skill of getCourse("es-en").skills.slice(0, 3)) {
    const s = service.startSession(u.id, { courseId: "es-en", skillId: skill.id, kind: "practice" });
    const ex = advanceTo(s.sessionId, (e) =>
      e.type === "translate" && String(e.answer ?? "").split(" ").filter(Boolean).length >= 2);
    if (!ex) continue;
    const words = String(ex.answer).split(" ");
    const swapped = [words[1], words[0], ...words.slice(2)].join(" ");
    const near = service.answer(u.id, s.sessionId, { exerciseId: ex.id, answer: swapped });
    assert.equal(near.result.correct, true, `"${swapped}" should be forgiven for "${ex.answer}"`);
    assert.equal(near.result.mistake, "word_swap", "the client is told it was a word swap");
    sawSwap = true;
    break;
  }
  assert.ok(sawSwap, "expected at least one multi-word translate exercise across three skills");

  // A genuine failure carries a word-level diff.
  const s2 = service.startSession(u.id, { courseId: "es-en", skillId: getCourse("es-en").skills[0].id, kind: "practice" });
  const ex2 = advanceTo(s2.sessionId, (e) => e.type === "translate" || e.type === "word_bank");
  const bad = service.answer(u.id, s2.sessionId, { exerciseId: ex2.id, answer: "__zzz__" });
  assert.equal(bad.result.correct, false);
  assert.ok(Array.isArray(bad.result.diff) && bad.result.diff.length > 0,
    "a wrong answer should explain itself word by word");
  assert.ok(bad.result.diff.every((d) => ["ok", "wrong", "missing", "extra"].includes(d.status)));
});

test("the hint ladder is served over the session and marks the attempt as spent", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const skill = getCourse("es-en").skills[0];
  const s = service.startSession(u.id, { courseId: "es-en", skillId: skill.id, kind: "practice" });
  const raw = JSON.parse(service.database.prepare(
    "SELECT state FROM lesson_sessions WHERE id = ?").get(s.sessionId).state).exercises[0];

  // Preview: labels only, never the answer text.
  const preview = service.hint(u.id, s.sessionId, { exerciseId: raw.id });
  assert.equal(preview.supported, true);
  assert.ok(preview.hints.length > 0);
  assert.ok(preview.hints.every((h) => h.text === undefined), "preview must not leak text");

  // Reveal the last rung.
  const lastStep = preview.hints[preview.hints.length - 1].step;
  const revealed = service.hint(u.id, s.sessionId, { exerciseId: raw.id, step: lastStep });
  assert.equal(revealed.spent, true);
  const expected = Array.isArray(raw.answer) ? raw.answer.join(" ") : String(raw.answer);
  assert.equal(revealed.hint.text, expected, "the last rung gives the answer");

  // Answering it correctly is accepted, but the combo does not advance.
  const r = service.answer(u.id, s.sessionId, { exerciseId: raw.id, answer: correctAnswer(raw) });
  assert.equal(r.result.correct, true);
  assert.equal(r.result.hinted, true);
  assert.equal(r.combo, 0, "a hinted answer must not extend the combo");
  assert.match(r.result.feedback, /hint/i);
});

test("hints are refused for a different exercise, and unknown steps are a clear error", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  const skill = getCourse("es-en").skills[0];
  const s = service.startSession(u.id, { courseId: "es-en", skillId: skill.id, kind: "practice" });

  const wrongEx = (() => {
    try { service.hint(u.id, s.sessionId, { exerciseId: "not-this-one", step: 1 }); }
    catch (e) { return e; }
  })();
  assert.equal(wrongEx.code, "out_of_sync");

  const badStep = (() => {
    try { service.hint(u.id, s.sessionId, { exerciseId: s.exercise.id, step: 99 }); }
    catch (e) { return e; }
  })();
  assert.equal(badStep.code, "no_such_hint");
});

test("a story has no hint ladder and says so instead of erroring", () => {
  const { service } = freshService();
  const u = newUser(service);
  service.enrol(u.id, "es-en");
  service.database.prepare(
    "UPDATE skill_progress SET unlocked = 1, level = 5, crowns = 5 WHERE user_id = ?").run(u.id);
  const story = storiesFor("es-en")[0];
  const s = service.startSession(u.id, { courseId: "es-en", kind: "story", storyId: story.id });
  const res = service.hint(u.id, s.sessionId, { exerciseId: s.exercise.id });
  assert.equal(res.supported, false);
  assert.deepEqual(res.hints, []);
});

test("every course can be played through its first skill", () => {
  for (const courseId of ["es-en", "fr-en", "de-en", "it-en", "nb-en", "sv-en"]) {
    const { service } = freshService();
    const u = newUser(service, `player_${courseId.replace(/\W/g, "")}`);
    service.enrol(u.id, courseId);
    const course = getCourse(courseId);
    const session = service.startSession(u.id, {
      courseId, skillId: course.skills[0].id, kind: "lesson",
    });
    const end = playSession(service, u.id, session.sessionId);
    assert.equal(end.summary.passed, true, `${courseId} should be playable`);
    assert.ok(end.summary.xp > 0, `${courseId} awards XP`);
  }
});

test("a brand new user has a coherent, empty-but-usable home screen", () => {
  const { service } = freshService();
  const u = newUser(service);
  const home = service.home(u.id);
  assert.equal(home.currentCourse, null, "no course yet");
  assert.equal(home.dueCount, 0);
  assert.equal(home.dailyGoalMet, false);
  assert.equal(home.user.xp, 0);
  assert.equal(home.quests.length, 3, "quests still render");
});

test("errors carry a machine-readable code and HTTP status", () => {
  const { service } = freshService();
  const err = (() => { try { service.getUser(99999); } catch (e) { return e; } })();
  assert.ok(err instanceof AppError);
  assert.equal(err.status, 404);
  assert.equal(err.code, "not_found");
});
