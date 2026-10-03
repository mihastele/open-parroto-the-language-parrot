/**
 * Parroto — hint ladder tests.
 *
 * The contract: every hintable exercise offers a ladder that starts gentle and ends with the
 * answer, the answer is only in the last rung, and an exercise with no ladder says so rather
 * than offering a dead button.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { hintsFor, hintPreview, hintStep, isHintable } from "../src/core/hints.mjs";
import { grade } from "../src/core/exercises.mjs";
import { COURSES, allItems } from "../src/content/courses.mjs";
import { buildExercise } from "../src/core/generator.mjs";

const TRANSLATE = {
  type: "translate", id: "t1", prompt: "I want water", answer: "yo quiero agua",
  accepted: ["yo quiero agua"], directions: "Translate",
};

const CHOICE = {
  type: "select_translation", id: "c1", prompt: "hello", answer: "hola",
  choices: ["hola", "adiós", "gracias", "agua"], directions: "Which one means hello?",
};

const IMAGE = {
  type: "select_image", id: "i1", prompt: "agua", answer: "💧",
  choices: [
    { id: "a", emoji: "💧", label: "water", correct: true },
    { id: "b", emoji: "🍞", label: "bread", correct: false },
    { id: "c", emoji: "🧀", label: "cheese", correct: false },
  ],
};

const BANK = {
  type: "word_bank", id: "b1", prompt: "I want water", bank: ["agua", "quiero", "yo"],
  answer: ["yo", "quiero", "agua"],
};

const BLANK = { type: "fill_blank", id: "f1", sentence: "yo ___ agua", answer: "quiero", choices: ["quiero", "como"] };
const SPEAK = { type: "speak", id: "s1", prompt: "I want water", answer: "yo quiero agua", tts: "es-ES" };
const STORY = { type: "story", id: "st1", lines: [], questions: [{ id: "q1", answer: "x" }] };

// ---------------------------------------------------------------- shape

test("a translate exercise offers a ladder ending in the answer", () => {
  const hints = hintsFor(TRANSLATE);
  assert.ok(hints.length >= 3, "several rungs");
  const last = hints[hints.length - 1];
  assert.equal(last.kind, "answer");
  assert.equal(last.reveals, true, "the last rung gives the answer");
  assert.equal(last.text, "yo quiero agua");

  // No earlier rung may contain the whole answer.
  for (const h of hints.slice(0, -1)) {
    assert.notEqual(h.text, "yo quiero agua", `step ${h.step} is not the answer`);
    assert.notEqual(h.reveals, true, `step ${h.step} must not reveal`);
  }
});

test("hint steps are numbered from 1", () => {
  const hints = hintsFor(TRANSLATE);
  hints.forEach((h, i) => assert.equal(h.step, i + 1));
});

test("hintPreview exposes the labels but never the answer text", () => {
  const preview = hintPreview(TRANSLATE);
  assert.equal(preview.length, hintsFor(TRANSLATE).length);
  for (const p of preview) {
    assert.equal(p.text, undefined, "preview must not carry the hint text");
    assert.ok(p.label, "but it says what the rung is");
    assert.ok(typeof p.step === "number");
  }
  assert.ok(!JSON.stringify(preview).includes("yo quiero agua"),
    "the answer must not leak through the preview");
});

test("hintStep returns the requested rung, and null for a bad step", () => {
  const one = hintStep(TRANSLATE, 1);
  assert.equal(one.step, 1);
  assert.ok(one.text.length > 0);
  assert.equal(hintStep(TRANSLATE, 99), null);
  assert.equal(hintStep(TRANSLATE, 0), null);
});

// ---------------------------------------------------------------- per type

test("word_bank hints build up to the order, and only the last reveals", () => {
  const hints = hintsFor(BANK);
  assert.ok(hints.some((h) => /tiles/i.test(h.text)), "says how many tiles");
  const reveal = hints.find((h) => h.reveals);
  assert.ok(reveal, "has a revealing rung");
  assert.match(reveal.text, /yo/);
});

test("choice hints eliminate wrong options rather than naming the right one", () => {
  const hints = hintsFor(CHOICE);
  assert.ok(hints.length >= 1);
  const eliminates = hints.filter((h) => h.kind === "eliminate");
  assert.ok(eliminates.length >= 1, "at least one wrong option is removed");
  for (const h of eliminates) {
    assert.ok(!h.text.includes("hola"), `must not name the right answer: ${h.text}`);
  }
  assert.ok(hints.some((h) => h.kind === "answer" && h.reveals), "still offers the answer last");
});

test("image hints do not reveal which image is correct before the last rung", () => {
  const hints = hintsFor(IMAGE);
  for (const h of hints.filter((x) => !x.reveals)) {
    assert.ok(!h.text.includes("💧"), `step ${h.step} must not name the correct emoji`);
  }
});

test("fill_blank hints give the word length and initial", () => {
  const hints = hintsFor(BLANK);
  assert.ok(hints.some((h) => /6 letters/.test(h.text)), `expected a length hint: ${JSON.stringify(hints)}`);
  assert.ok(hints.some((h) => /begins with/i.test(h.text)));
});

test("speak hints translate the prompt and offer slow playback", () => {
  const hints = hintsFor(SPEAK);
  assert.ok(hints.some((h) => /you are saying/i.test(h.text)));
  assert.ok(hints.some((h) => h.action === "play_slow"), "offers a slow replay");
});

test("a story has no hint ladder", () => {
  assert.equal(isHintable(STORY), false);
  assert.deepEqual(hintsFor(STORY), []);
  assert.deepEqual(hintPreview(STORY), []);
});

test("an exercise with no answer offers no ladder", () => {
  assert.deepEqual(hintsFor({ type: "translate", id: "x" }), []);
});

// ---------------------------------------------------------------- content coverage

test("every exercise the courses can generate has a usable ladder or is a story", () => {
  for (const course of COURSES) {
    for (const skill of course.skills) {
      const items = skill.items.map((i) => ({ ...i, skillId: skill.id }));
      for (const item of items) {
        for (const type of ["translate", "word_bank", "order_words", "fill_blank",
                            "select_translation", "select_image", "listen_select",
                            "listen_type", "speak", "identify_character"]) {
          const ex = buildExercise(item, type, items, { seed: 1, tts: course.tts, toName: course.to });
          if (!ex) continue;
          const hints = hintsFor(ex);
          assert.ok(hints.length > 0,
            `${course.id}/${item.id} ${type}: no hints offered`);
          assert.ok(hints.some((h) => h.reveals),
            `${course.id}/${item.id} ${type}: no rung reveals the answer`);
          // The revealing rung must actually be the right answer.
          const reveal = hints.find((h) => h.reveals);
          const expected = Array.isArray(ex.answer) ? ex.answer.join(" ") : String(ex.answer);
          assert.equal(reveal.text, expected,
            `${course.id}/${item.id} ${type}: revealing rung shows the wrong thing`);
        }
      }
    }
  }
});

test("a revealed answer is the answer the grader accepts", () => {
  // The hint must not teach something the grader will then mark wrong.
  for (const course of COURSES) {
    const all = allItems(course);
    for (const item of all.slice(0, 25)) {
      const ex = buildExercise(item, "translate", all, { seed: 2, tts: course.tts, toName: course.to });
      if (!ex) continue;
      const reveal = hintsFor(ex).find((h) => h.reveals);
      const r = grade(ex, reveal.text, { lang: course.tts.slice(0, 2) });
      assert.equal(r.correct, true,
        `${course.id}/${item.id}: the hinted answer "${reveal.text}" is graded wrong`);
    }
  }
});
