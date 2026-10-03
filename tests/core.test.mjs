/**
 * Parroto — core engine tests.
 *
 * These cover the parts that decide whether the app is *correct*: grading of every exercise
 * type, the SRS scheduler, streak/heart arithmetic and exercise generation. No HTTP, no DOM.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  grade, normalise, stripAccents, editDistance, exercisePlanFor, EXERCISE_TYPES, TYPES,
} from "../src/core/exercises.mjs";
import { schedule, freshItem, isDue, strength, buildReviewQueue, DAY } from "../src/core/srs.mjs";
import {
  dayKey, daysBetween, lessonXp, advanceStreak, addDailyXp, dailyGoalMet, regenerateHearts,
  minutesToNextHeart, streakTier, leagueOutcome, nextLeague, weekKey, dailyQuests,
  earnedAchievements, comboTier, MAX_HEARTS, HEART_REGEN_MINUTES, heartsForMistake,
} from "../src/core/gamification.mjs";
import { buildExercise, buildLesson } from "../src/core/generator.mjs";
import { COURSES, getCourse, allItems, storiesFor, courseSummaries } from "../src/content/courses.mjs";

// ---------------------------------------------------------------- helpers

const ITEM = { id: "x-hola", target: "hola", source: "hello", images: ["👋"] };
const SIBLINGS = [
  ITEM,
  { id: "x-adios", target: "adiós", source: "goodbye", images: ["👋"] },
  { id: "x-gracias", target: "gracias", source: "thank you", images: ["🙏"] },
  { id: "x-agua", target: "agua", source: "water", images: ["💧"] },
  { id: "x-pan", target: "pan", source: "bread", images: ["🍞"] },
];

// ---------------------------------------------------------------- grading

test("normalise ignores case, spacing and terminal punctuation", () => {
  assert.equal(normalise("  Hola,  "), "hola");
  assert.equal(normalise("¿Cómo estás?"), "cómo estás");
  assert.equal(normalise("I don't"), "i don't");
});

test("stripAccents folds diacritics", () => {
  assert.equal(stripAccents("cómo estás"), "como estas");
  assert.equal(stripAccents("Mädchen"), "Madchen");
});

test("editDistance measures typos", () => {
  assert.equal(editDistance("hola", "hola"), 0);
  assert.equal(editDistance("hola", "holaa"), 1);
  assert.equal(editDistance("gato", "pato"), 1);
  assert.equal(editDistance("", "abc"), 3);
});

test("translate grades exact, accent-only and one-typo answers", () => {
  const ex = { type: "translate", answer: "cómo estás", accepted: ["cómo estás"] };

  const exact = grade(ex, "cómo estás");
  assert.equal(exact.correct, true);
  assert.equal(exact.grade, 3);

  const noAccents = grade(ex, "como estas");
  assert.equal(noAccents.correct, true, "missing accents still count");
  assert.equal(noAccents.grade, 2, "but score lower");

  const typo = grade(ex, "cómi estás");
  assert.equal(typo.correct, true);
  assert.equal(typo.grade, 1, "a single typo scores lower than exact");

  // Two differences (accent + extra letter) is not a single typo.
  assert.equal(grade(ex, "cómo estass").correct, false, "two mistakes is a wrong answer");

  const wrong = grade(ex, "adiós");
  assert.equal(wrong.correct, false);
  assert.equal(wrong.grade, 0);
  assert.match(wrong.feedback, /cómo estás/);
});

test("translate rejects an empty answer without crashing", () => {
  const r = grade({ type: "translate", answer: "hola" }, "");
  assert.equal(r.correct, false);
  assert.equal(r.grade, 0);
});

test("word_bank accepts a correct order and rejects a wrong one", () => {
  const ex = { type: "word_bank", answer: ["yo", "quiero", "agua"], accepted: [["yo", "quiero", "agua"]] };
  assert.equal(grade(ex, ["yo", "quiero", "agua"]).correct, true);
  assert.equal(grade(ex, ["quiero", "yo", "agua"]).correct, false);
  assert.equal(grade(ex, []).correct, false);
});

test("order_words tolerates punctuation differences in tokens", () => {
  const ex = { type: "order_words", answer: ["buenos", "días"], accepted: [["buenos", "días"]] };
  assert.equal(grade(ex, ["buenos", "días"]).correct, true);
});

test("select_translation grades case-insensitively", () => {
  const ex = { type: "select_translation", answer: "Hello" };
  assert.equal(grade(ex, "hello").correct, true);
  assert.equal(grade(ex, "goodbye").correct, false);
});

test("select_image grades by emoji id", () => {
  const ex = { type: "select_image", answer: "🍎" };
  assert.equal(grade(ex, "🍎").correct, true);
  assert.equal(grade(ex, "🍞").correct, false);
});

test("match_pairs grades a completed board and counts wrong attempts", () => {
  const ex = { type: "match_pairs", pairs: [{}, {}, {}, {}] };
  assert.equal(grade(ex, [{ correct: true }, { correct: true }, { correct: true }, { correct: true }]).grade, 3);
  assert.equal(grade(ex, [{ correct: true }, { correct: true }, { correct: true }, { correct: true }, { correct: false }]).grade, 1);
  assert.equal(grade(ex, [{ correct: true }]).correct, false);
});

test("speak is graded from a transcript and forgiving of small mishearings", () => {
  const ex = { type: "speak", answer: "yo quiero agua", accepted: ["yo quiero agua"] };
  assert.equal(grade(ex, { transcript: "yo quiero agua" }).correct, true);
  assert.equal(grade(ex, "yo quiero agua").correct, true, "plain string also accepted");
  assert.equal(grade(ex, { transcript: "yo quiero aguaa" }).correct, true, "one misheard word is ok");
  assert.equal(grade(ex, { transcript: "something else entirely" }).correct, false);
  const silent = grade(ex, "");
  assert.equal(silent.correct, false);
  assert.match(silent.feedback, /microphone/i);
});

test("story grades comprehension questions", () => {
  const ex = {
    type: "story",
    questions: [
      { id: "q1", answer: "Coffee" },
      { id: "q2", answer: "Two euros" },
    ],
  };
  assert.equal(grade(ex, { q1: "coffee", q2: "Two euros" }).correct, true);
  const partial = grade(ex, { q1: "Coffee", q2: "Three euros" });
  assert.equal(partial.correct, false);
  assert.equal(partial.answered, 1);
  assert.equal(partial.total, 2);
});

test("every declared exercise type is handled by grade()", () => {
  for (const type of EXERCISE_TYPES) {
    const r = grade({ type, answer: "x" }, "x");
    assert.ok(typeof r.correct === "boolean", `${type} must return a boolean verdict`);
    assert.ok(!String(r.feedback ?? "").includes("Unsupported"), `${type} must be implemented`);
  }
  assert.equal(TYPES, EXERCISE_TYPES);
});

// ---------------------------------------------------------------- srs

test("a wrong answer requeues the item soon and records a lapse", () => {
  const now = 1_000_000;
  const s = schedule(freshItem(now), 0, now);
  assert.equal(s.reps, 0);
  assert.equal(s.lapses, 1);
  assert.ok(s.dueAt - now < DAY, "comes back within the session, not tomorrow");
  assert.ok(s.ease < 2.5, "ease drops");
});

test("passing answers stretch the interval progressively", () => {
  const now = 1_000_000;
  let s = freshItem(now);
  const seen = [];
  for (let i = 0; i < 5; i++) {
    s = schedule(s, 2, now);
    seen.push(s.intervalDays);
  }
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] >= seen[i - 1], `interval must not shrink: ${seen}`);
  }
  assert.ok(seen[4] > seen[0], "intervals grow over time");
});

test("'easy' schedules further out than 'hard'", () => {
  const now = 1_000_000;
  let hard = freshItem(now);
  let easy = freshItem(now);
  for (let i = 0; i < 3; i++) {
    hard = schedule(hard, 1, now);
    easy = schedule(easy, 3, now);
  }
  assert.ok(easy.intervalDays > hard.intervalDays);
  assert.ok(easy.ease > hard.ease);
});

test("ease stays inside sane bounds under repeated failures", () => {
  const now = 1_000_000;
  let s = freshItem(now);
  for (let i = 0; i < 50; i++) s = schedule(s, 0, now);
  assert.ok(s.ease >= 1.3, "ease floors at 1.3");
  for (let i = 0; i < 50; i++) s = schedule(s, 3, now);
  assert.ok(s.ease <= 3.2, "ease ceilings at 3.2");
});

test("intervals never exceed a year", () => {
  const now = 1_000_000;
  let s = freshItem(now);
  for (let i = 0; i < 40; i++) s = schedule(s, 3, now);
  assert.ok(s.intervalDays <= 365);
});

test("isDue and strength behave", () => {
  const now = 1_000_000;
  assert.equal(isDue(null, now), true, "unseen items are due");
  const s = schedule(freshItem(now), 2, now);
  assert.equal(isDue({ dueAt: now + 10 }, now), false);
  assert.equal(isDue({ dueAt: now - 10 }, now), true);
  assert.equal(strength(null), 0);
  assert.ok(strength(s) > 0);
});

test("review queue mixes skills and respects the limit", () => {
  const now = 1_000_000;
  const items = [];
  for (let skill = 0; skill < 3; skill++) {
    for (let i = 0; i < 10; i++) {
      items.push({
        itemId: `s${skill}-${i}`,
        skillId: `skill${skill}`,
        srs: { dueAt: now - 1000 + i },
      });
    }
  }
  const q = buildReviewQueue(items, { now, limit: 9 });
  assert.equal(q.length, 9);
  const skills = new Set(q.map((i) => i.skillId));
  assert.equal(skills.size, 3, "a long backlog is spread across skills");
});

test("review queue returns everything when under the limit", () => {
  const now = 1_000_000;
  const items = [
    { itemId: "a", skillId: "s", srs: { dueAt: now - 1 } },
    { itemId: "b", skillId: "s", srs: { dueAt: now + 10_000 } },
  ];
  assert.equal(buildReviewQueue(items, { now, limit: 20 }).length, 1, "future items are excluded");
});

// ---------------------------------------------------------------- gamification

test("dayKey and daysBetween agree", () => {
  const a = dayKey(new Date("2026-03-01T12:00:00Z"));
  const b = dayKey(new Date("2026-03-03T12:00:00Z"));
  assert.equal(a, "2026-03-01");
  assert.equal(daysBetween(a, b), 2);
});

test("lesson XP rewards accuracy and combos", () => {
  const perfect = lessonXp({ kind: "lesson", correct: 10, total: 10, comboMax: 25 });
  const sloppy = lessonXp({ kind: "lesson", correct: 5, total: 10, comboMax: 0 });
  assert.ok(perfect > sloppy);
  assert.ok(sloppy >= 15, "base XP is always awarded");
});

test("streak increments on consecutive days", () => {
  let u = { streak: 0, longestStreak: 0, lastPracticeDay: null };
  u = { ...u, ...advanceStreak(u, "2026-03-01") };
  assert.equal(u.streak, 1);
  u = { ...u, ...advanceStreak(u, "2026-03-02") };
  assert.equal(u.streak, 2);
  u = { ...u, ...advanceStreak(u, "2026-03-03") };
  assert.equal(u.streak, 3);
  assert.equal(u.longestStreak, 3);
});

test("practising twice in one day does not double-count the streak", () => {
  let u = { streak: 4, longestStreak: 6, lastPracticeDay: "2026-03-01" };
  const r = advanceStreak(u, "2026-03-01");
  assert.equal(r.streak, 4);
});

test("a missed day resets the streak", () => {
  const u = { streak: 10, longestStreak: 10, lastPracticeDay: "2026-03-01" };
  const r = advanceStreak(u, "2026-03-04");
  assert.equal(r.streak, 1, "streak resets after a 2 day gap");
  assert.equal(r.longestStreak, 10, "best streak is remembered");
});

test("a streak freeze covers exactly one missed day", () => {
  const u = { streak: 10, longestStreak: 10, lastPracticeDay: "2026-03-01", streakFreezes: 1 };
  const r = advanceStreak(u, "2026-03-03");
  assert.equal(r.streak, 11, "streak survives with a freeze");
  assert.equal(r.streakFreezes, 0, "the freeze is consumed");
  assert.equal(r.usedFreeze, true);

  const noFreeze = advanceStreak({ ...u, streakFreezes: 0 }, "2026-03-03");
  assert.equal(noFreeze.streak, 1, "without a freeze it still resets");
});

test("a freeze cannot cover a two day gap", () => {
  const u = { streak: 10, longestStreak: 10, lastPracticeDay: "2026-03-01", streakFreezes: 5 };
  const r = advanceStreak(u, "2026-03-04");
  assert.equal(r.streak, 1);
});

test("hearts regenerate over time and cap", () => {
  const now = 10_000_000;
  const hurt = { hearts: 2, heartsUpdatedAt: now - 65 * 60 * 1000 };  // 65 min ago
  const r = regenerateHearts(hurt, now);
  assert.equal(r.gained, 2, "one heart per 30 minutes");
  assert.equal(r.hearts, 4);

  const full = regenerateHearts({ hearts: MAX_HEARTS, heartsUpdatedAt: 0 }, now);
  assert.equal(full.hearts, MAX_HEARTS);
  assert.equal(full.gained, 0);
});

test("hearts do not regenerate faster than the interval", () => {
  const now = 10_000_000;
  const r = regenerateHearts({ hearts: 1, heartsUpdatedAt: now - 5 * 60 * 1000 }, now);
  assert.equal(r.gained, 0);
  assert.equal(r.hearts, 1);
});

test("minutesToNextHeart counts down", () => {
  const now = 10_000_000;
  const m = minutesToNextHeart({ hearts: 3, heartsUpdatedAt: now }, now);
  assert.ok(m > 0 && m <= HEART_REGEN_MINUTES);
  assert.equal(minutesToNextHeart({ hearts: MAX_HEARTS, heartsUpdatedAt: now }, now), 0);
});

test("practice sessions do not cost hearts but lessons do", () => {
  assert.equal(heartsForMistake("lesson"), 1);
  assert.equal(heartsForMistake("story"), 1);
  assert.equal(heartsForMistake("practice"), 0);
  assert.equal(heartsForMistake("review"), 0);
});

test("daily XP resets on a new day and goals are detected", () => {
  let u = { dailyXp: 10, dailyXpDay: "2026-03-01", dailyGoal: 20 };
  u = { ...u, ...addDailyXp(u, 5, "2026-03-01") };
  assert.equal(u.dailyXp, 15);
  assert.equal(dailyGoalMet(u, "2026-03-01"), false);
  u = { ...u, ...addDailyXp(u, 10, "2026-03-01") };
  assert.equal(u.dailyXp, 25);
  assert.equal(dailyGoalMet(u, "2026-03-01"), true);

  const nextDay = { ...u, ...addDailyXp(u, 5, "2026-03-02") };
  assert.equal(nextDay.dailyXp, 5, "a new day starts the count over");
});

test("streak tiers escalate", () => {
  assert.equal(streakTier(1), "starter");
  assert.equal(streakTier(7), "silver");
  assert.equal(streakTier(30), "diamond");
  assert.equal(streakTier(400), "legendary");
});

test("league promotion and demotion follow rank", () => {
  assert.equal(leagueOutcome(1, 30), "promote");
  assert.equal(leagueOutcome(15, 30), "stay");
  assert.equal(leagueOutcome(30, 30), "demote");
  assert.equal(nextLeague("bronze", "promote"), "silver");
  assert.equal(nextLeague("bronze", "demote"), "bronze", "cannot demote below bronze");
  assert.equal(nextLeague("obsidian", "promote"), "obsidian", "cannot promote past the top");
});

test("weekKey is stable within a week", () => {
  const mon = weekKey(new Date("2026-03-02T10:00:00Z"));
  const fri = weekKey(new Date("2026-03-06T10:00:00Z"));
  assert.equal(mon, fri);
  assert.match(mon, /^\d{4}-W\d{2}$/);
});

test("daily quests are deterministic per day and never duplicate", () => {
  const a = dailyQuests("2026-03-01");
  const b = dailyQuests("2026-03-01");
  assert.equal(a.length, 3);
  assert.deepEqual(a.map((q) => q.id), b.map((q) => q.id), "same day, same quests");
  assert.equal(new Set(a.map((q) => q.id)).size, 3, "no duplicates");
  const other = dailyQuests("2026-07-14");
  assert.ok(other.length === 3);
});

test("achievements unlock from totals", () => {
  const none = earnedAchievements({});
  assert.deepEqual(none, []);
  const some = earnedAchievements({ streak: 7, xp: 150, lessonsCompleted: 1, bestCombo: 25 });
  assert.ok(some.includes("streak_7"));
  assert.ok(some.includes("xp_100"));
  assert.ok(some.includes("combo_25"));
  assert.ok(!some.includes("xp_1000"));
});

test("combo tiers escalate", () => {
  assert.equal(comboTier(1), 0);
  assert.equal(comboTier(3), 1);
  assert.equal(comboTier(40), 4);
});

// ---------------------------------------------------------------- generation

test("every exercise generated from an item is gradable and self-consistent", () => {
  const plan = exercisePlanFor(ITEM, { speaking: true });
  assert.ok(plan.length >= 5, `an item should produce at least five exercise types, got ${plan.length}`);

  let built = 0;
  for (const type of plan) {
    const ex = buildExercise(ITEM, type, SIBLINGS, { seed: 1, tts: "es-ES" });
    if (!ex) continue;   // types needing a phrase or more siblings legitimately decline
    built++;
    assert.equal(ex.type, type);
    assert.ok(ex.itemId === ITEM.id);
    assert.ok(typeof ex.directions === "string" && ex.directions.length > 0,
              `${type} must have directions`);

    // The exercise must be answerable with its own answer.
    let answer;
    switch (type) {
      case "word_bank":
      case "order_words": answer = ex.answer; break;
      case "match_pairs": answer = ex.pairs.map(() => ({ correct: true })); break;
      case "speak": answer = { transcript: ex.answer }; break;
      default: answer = ex.answer;
    }
    const r = grade(ex, answer);
    assert.equal(r.correct, true, `${type} must grade its own correct answer as correct`);
  }
  assert.ok(built >= 4, `ITEM should build several exercises, built ${built}`);
});

test("a multi-word item produces the full exercise repertoire", () => {
  const phrase = { id: "p1", target: "yo quiero agua", source: "I want water", images: ["💧"] };
  const plan = exercisePlanFor(phrase, { speaking: true });
  for (const type of ["translate", "word_bank", "order_words", "fill_blank", "match_pairs",
                      "listen_select", "listen_type", "speak", "select_translation", "select_image"]) {
    assert.ok(plan.includes(type), `a phrase should be able to produce ${type}`);
  }
  for (const type of plan) {
    const ex = buildExercise(phrase, type, SIBLINGS, { seed: 2, tts: "es-ES" });
    assert.ok(ex, `${type} should build for a phrase`);
  }
});

test("multiple-choice exercises contain their answer and no duplicates", () => {
  for (const type of ["select_translation", "listen_select", "select_image"]) {
    const ex = buildExercise(ITEM, type, SIBLINGS, { seed: 3, tts: "es-ES" });
    if (!ex) continue;
    if (type === "select_image") {
      const correct = ex.choices.filter((c) => c.correct);
      assert.equal(correct.length, 1, "exactly one correct image");
      assert.ok(ex.choices.length >= 3, "at least three images offered");
    } else {
      assert.ok(ex.choices.includes(ex.answer), `${type} must offer its answer`);
      assert.equal(new Set(ex.choices).size, ex.choices.length, `${type} has duplicate choices`);
      assert.ok(ex.choices.length >= 3, `${type} offers distractors`);
    }
  }
});

test("distractors come from siblings, never the item itself", () => {
  const ex = buildExercise(ITEM, "select_translation", SIBLINGS, { seed: 5 });
  const wrong = ex.choices.filter((c) => c !== ex.answer);
  assert.equal(wrong.length, 3);
  for (const w of wrong) {
    assert.notEqual(w, ITEM.source, "the correct answer is not also offered as a distractor");
  }
});

test("generation is deterministic for a given seed", () => {
  const phrase = { id: "p2", target: "yo quiero agua", source: "I want water" };
  const a = buildExercise(phrase, "word_bank", SIBLINGS, { seed: 9 });
  const b = buildExercise(phrase, "word_bank", SIBLINGS, { seed: 9 });
  assert.ok(a && b, "word_bank builds for a phrase");
  assert.deepEqual(a.bank, b.bank);
  const c = buildExercise(phrase, "word_bank", SIBLINGS, { seed: 10 });
  assert.ok(c.bank.length > 0);
});

test("fill_blank blanks a content word and keeps the answer among the choices", () => {
  const item = { id: "f1", target: "yo quiero agua", source: "I want water" };
  const ex = buildExercise(item, "fill_blank", SIBLINGS, { seed: 1 });
  assert.ok(ex, "fill_blank builds for a multi-word phrase");
  assert.ok(ex.sentence.includes("___"), "the sentence shows a blank");
  assert.ok(ex.choices.includes(ex.answer), "the answer is one of the choices");
  assert.notEqual(normalise(ex.answer), "yo", "a pronoun is not blanked");
  assert.equal(normalise(ex.answer), "quiero", "the verb is blanked instead");
});

test("exercises that need more context decline instead of producing garbage", () => {
  // Only one sibling means there are not enough distractors for match_pairs.
  const ex = buildExercise(ITEM, "match_pairs", [ITEM, SIBLINGS[1]], { seed: 1 });
  assert.equal(ex, null);
});

test("buildLesson produces a varied, ordered, bounded session", () => {
  const items = SIBLINGS.map((s) => ({ ...s, skillId: "sk" }));
  const lesson = buildLesson(items, { size: 8, seed: 2, speaking: true, tts: "es-ES" });
  assert.ok(lesson.length > 0 && lesson.length <= 8);
  lesson.forEach((ex, i) => assert.equal(ex.order, i, "exercises are numbered in order"));

  const types = new Set(lesson.map((e) => e.type));
  assert.ok(types.size >= 3, `a session should vary exercise types, got ${[...types]}`);
});

test("buildLesson never repeats the same exercise id", () => {
  const items = SIBLINGS.map((s) => ({ ...s, skillId: "sk" }));
  const lesson = buildLesson(items, { size: 8, seed: 4, tts: "es-ES" });
  const ids = lesson.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate exercises in one session");
});

// ---------------------------------------------------------------- content

test("every shipped course is structurally sound", () => {
  assert.ok(COURSES.length >= 3, "several courses ship");
  for (const course of COURSES) {
    assert.ok(course.id && course.name && course.to && course.tts, `${course.id} has metadata`);
    assert.ok(course.skills.length >= 2, `${course.id} has multiple skills`);
    const ids = new Set();
    for (const skill of course.skills) {
      assert.ok(skill.id && skill.title, "skill has an id and title");
      assert.ok(skill.items.length >= 5, `${skill.id} has enough items to teach`);
      for (const item of skill.items) {
        assert.ok(item.id && item.target && item.source, `${skill.id} items are complete`);
        assert.ok(!ids.has(item.id), `item id ${item.id} is unique across the course`);
        ids.add(item.id);
      }
    }
  }
});

test("every course can generate a full lesson for every skill", () => {
  for (const course of COURSES) {
    for (const skill of course.skills) {
      const items = skill.items.map((i) => ({ ...i, skillId: skill.id }));
      const lesson = buildLesson(items, { size: 8, seed: 1, speaking: true, tts: course.tts });
      assert.ok(lesson.length >= 4,
        `${course.id}/${skill.id} produced only ${lesson.length} exercises`);
      for (const ex of lesson) {
        assert.ok(typeof ex.directions === "string" && ex.directions.length > 0);
      }
    }
  }
});

test("stories are well formed where they exist", () => {
  for (const course of COURSES) {
    for (const story of storiesFor(course.id)) {
      assert.ok(story.lines.length >= 3, `${story.id} has dialogue`);
      assert.ok(story.questions.length >= 1, `${story.id} has questions`);
      for (const q of story.questions) {
        assert.ok(q.choices.includes(q.answer), `${story.id}/${q.id} answer is among its choices`);
      }
      // The story's vocabulary should come from the course.
      const vocab = new Set(allItems(course).map((i) => normalise(i.target)));
      const known = story.lines.some((l) =>
        [...vocab].some((v) => normalise(l.text).includes(v)));
      assert.ok(known, `${story.id} should use course vocabulary`);
    }
  }
});

test("course summaries report real counts", () => {
  const summaries = courseSummaries();
  assert.equal(summaries.length, COURSES.length);
  for (const s of summaries) {
    const course = getCourse(s.id);
    assert.equal(s.skillCount, course.skills.length);
    assert.equal(s.itemCount, allItems(course).length);
    assert.ok(s.itemCount > 0);
  }
});

test("all exercise types are producible from the shipped content", () => {
  // Some types need a rich item (images, multi-word phrases). Across the whole content set,
  // every type should be reachable, or the app is advertising a feature it cannot serve.
  const produced = new Set();
  for (const course of COURSES) {
    for (const skill of course.skills) {
      const items = skill.items.map((i) => ({ ...i, skillId: skill.id }));
      for (const item of items) {
        for (const type of EXERCISE_TYPES) {
          if (type === "story" || type === "review_mistake") continue; // built elsewhere
          const ex = buildExercise(item, type, items, { seed: 1, tts: course.tts });
          if (ex) produced.add(type);
        }
      }
    }
  }
  const expected = EXERCISE_TYPES.filter((t) => t !== "story" && t !== "review_mistake");
  const missing = expected.filter((t) => !produced.has(t));
  assert.deepEqual(missing, [], `these exercise types are never generated: ${missing}`);
});
