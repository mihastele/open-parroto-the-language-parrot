/**
 * Parroto — forgiving grading tests.
 *
 * The point of this suite is the boundary: be generous about the mistakes a learner actually
 * makes (a dropped accent, a stray article, two words swapped, a typo), and still fail answers
 * that are genuinely wrong. Every "accepts" case below has a matching "rejects" case, because
 * an over-forgiving grader is worse than a strict one — it teaches the wrong language.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  grade, classifyMistake, editDistanceWithTransposition, diffWords, similarity,
} from "../src/core/exercises.mjs";

/** Convenience: grade a typed answer against one expected phrase. */
function g(expected, given, type = "translate") {
  return grade({ type, answer: expected, accepted: [expected] }, given, { lang: "es" });
}

// ---------------------------------------------------------------- character-level

test("editDistanceWithTransposition counts an adjacent swap as one edit", () => {
  assert.equal(editDistanceWithTransposition("hola", "hola"), 0);
  assert.equal(editDistanceWithTransposition("hola", "hloa"), 1, "swapped letters");
  assert.equal(editDistanceWithTransposition("recieve", "receive"), 1);
  assert.equal(editDistanceWithTransposition("gato", "pato"), 1, "substitution");
  assert.equal(editDistanceWithTransposition("gato", "gattto"), 2, "insertions still cost");
});

test("similarity is 1 for equal strings and drops with distance", () => {
  assert.equal(similarity("abc", "abc"), 1);
  assert.ok(similarity("abc", "abd") > 0.6);
  assert.ok(similarity("abc", "xyz") < 0.2);
});

// ---------------------------------------------------------------- accepted mistakes

test("a perfect answer scores highest", () => {
  const r = g("yo quiero agua", "yo quiero agua");
  assert.equal(r.correct, true);
  assert.equal(r.grade, 3);
  assert.equal(r.mistake, undefined, "no mistake was made");
});

test("missing accents still pass, but score lower and say so", () => {
  const r = g("cómo estás", "como estas");
  assert.equal(r.correct, true);
  assert.equal(r.grade, 2);
  assert.equal(r.mistake, "accents");
  assert.match(r.feedback, /accents/i);
});

test("an extra article is forgiven", () => {
  const r = g("yo quiero agua", "quiero agua");
  assert.equal(r.correct, true, "dropping the subject pronoun is fine");
  assert.match(r.feedback, /added a word/i);

  const r2 = g("quiero agua", "yo quiero agua");
  assert.equal(r2.correct, true, "adding one is fine too");
});

test("two adjacent words swapped are forgiven", () => {
  const r = g("yo quiero agua", "quiero yo agua");
  assert.equal(r.correct, true);
  assert.equal(r.grade, 1);
  assert.equal(r.mistake, "word_swap");
  assert.match(r.feedback, /other way round|order/i);
});

test("a single typo is forgiven and names the correction", () => {
  const r = g("yo quiero agua", "yo quiero agau");
  assert.equal(r.correct, true);
  assert.equal(r.mistake, "typo");
  assert.match(r.feedback, /spelled|letter/i);
});

test("a transposed letter inside a word is a single typo", () => {
  const r = g("gracias", "garcias");
  assert.equal(r.correct, true, "'garcias' is 'gracias' with two letters swapped");
  assert.equal(r.mistake, "typo");
});

test("two typos in a long sentence still pass", () => {
  const r = g("yo quiero agua por favor", "yo quiero agau por fovor");
  assert.equal(r.correct, true);
  assert.ok(r.grade >= 1);
});

test("a missing or extra word in a sentence is forgiven", () => {
  const missing = g("yo quiero un cafe por favor", "yo quiero cafe por favor");
  assert.equal(missing.correct, true, `dropped "un": ${missing.feedback}`);
  const extra = g("yo quiero cafe", "yo quiero un cafe");
  assert.equal(extra.correct, true, `added "un": ${extra.feedback}`);
});

test("a dropped letter is forgiven on an ordinary word", () => {
  // Regression: this compared the SHORTER string's length (4) against a threshold of 5, so a
  // deletion from a 5-letter word was wrongly rejected.
  assert.equal(g("jag heter", "jag hetr").correct, true, "missing a letter in 'heter'");
  assert.equal(g("gracias", "gracis").correct, true);
});

test("a substitution is only forgiven on a longer word", () => {
  // Substitution is the risky edit: that is exactly how a different real word appears.
  assert.equal(g("kvinnan", "kvinnin").correct, true, "7 letters: a slip");
  assert.equal(g("gato", "pato").correct, false, "4 letters: a different word");
  assert.equal(g("agua", "ogua").correct, false, "4 letters: a different word");
  assert.equal(g("no", "si").correct, false, "2 letters: definitely a different word");
});

test("an insertion is forgiven on an ordinary word", () => {
  assert.equal(g("gracias", "graciass").correct, true);
  assert.equal(g("hola", "hhola").correct, true);
});

test("a transposed letter is forgiven in any word length", () => {
  // Transpositions are always safe to forgive: they cannot accidentally form another real word.
  assert.equal(g("agua", "agau").correct, true);
  assert.equal(g("hola", "hloa").correct, true);
});

test("the forgiveness rule distinguishes edits by risk, not just by count", () => {
  // An insertion/deletion is forgiven on an ordinary word length; a substitution is not, because
  // that is how a different real word appears ("gato"/"pato").
  assert.equal(g("hola", "holaa").correct, true, "insertion on a 4-letter word");
  assert.equal(g("gracias", "graciass").correct, true, "insertion on a 7-letter word");
  assert.equal(g("gato", "pato").correct, false, "substitution on a 4-letter word");
  assert.equal(g("kvinnan", "kvinnin").correct, true, "substitution on a 7-letter word");
});

// ---------------------------------------------------------------- rejected answers

test("a completely different answer is rejected", () => {
  const r = g("yo quiero agua", "la mujer come pan");
  assert.equal(r.correct, false);
  assert.equal(r.grade, 0);
  assert.match(r.feedback, /Not quite/);
});

test("the wrong word is rejected even when it is the same length", () => {
  const r = g("el gato", "el pato");
  assert.equal(r.correct, false, "gato/pato is one edit but a different word");
});

test("two different short words are not a typo", () => {
  assert.equal(g("no", "si").correct, false);
  assert.equal(g("la", "el").correct, false);
});

test("swapping non-adjacent words is rejected", () => {
  const r = g("yo quiero agua fria", "agua yo quiero fria");
  assert.equal(r.correct, false, "a three-way shuffle is a real ordering mistake");
});

test("a missing word that changes meaning is rejected", () => {
  // Dropping "no" reverses the meaning, so it must not be forgiven.
  const r = g("yo no entiendo", "yo entiendo");
  assert.equal(r.correct, false, "dropping a negation must fail");
});

test("a totally empty answer is rejected", () => {
  assert.equal(g("hola", "").correct, false);
  assert.equal(g("hola", "   ").correct, false);
});

test("extra words beyond the allowance are rejected", () => {
  const r = g("hola", "hola amigo mio querido");
  assert.equal(r.correct, false);
});

// ---------------------------------------------------------------- word bank / order

test("word_bank accepts the exact order and a swapped pair", () => {
  const ex = { type: "word_bank", answer: ["yo", "quiero", "agua"], accepted: [["yo", "quiero", "agua"]] };
  assert.equal(grade(ex, ["yo", "quiero", "agua"]).grade, 3);
  const swapped = grade(ex, ["quiero", "yo", "agua"]);
  assert.equal(swapped.correct, true, "adjacent swap forgiven");
  assert.equal(swapped.mistake, "word_swap");
});

test("word_bank rejects a genuinely wrong order", () => {
  const ex = { type: "word_bank", answer: ["yo", "quiero", "agua"], accepted: [["yo", "quiero", "agua"]] };
  const r = grade(ex, ["agua", "yo", "quiero"]);
  assert.equal(r.correct, false, "a rotation is not a swap");
});

test("word_bank forgives one misspelled token", () => {
  const ex = { type: "order_words", answer: ["yo", "quiero", "agua"], accepted: [["yo", "quiero", "agua"]] };
  const r = grade(ex, ["yo", "quiero", "agau"]);
  assert.equal(r.correct, true);
  assert.equal(r.mistake, "typo");
});

test("fill_blank forgives a typo in the typed word", () => {
  const ex = { type: "fill_blank", answer: "quiero", choices: ["quiero", "como"] };
  assert.equal(grade(ex, "quiero").grade, 3);
  const typo = grade(ex, "quieor");
  assert.equal(typo.correct, true, "transposed letters");
});

test("select_translation does not forgive a different option", () => {
  const ex = { type: "select_translation", answer: "hello", choices: ["hello", "goodbye"] };
  assert.equal(grade(ex, "hello").correct, true);
  assert.equal(grade(ex, "goodbye").correct, false);
});

// ---------------------------------------------------------------- classification

test("classifyMistake names each category, and null when equal", () => {
  assert.equal(classifyMistake("cómo estás", "como estas"), "accents");
  assert.equal(classifyMistake("yo quiero agua", "quiero agua"), "extra_word");
  assert.equal(classifyMistake("yo quiero agua", "quiero yo agua"), "word_swap");
  assert.equal(classifyMistake("gracias", "garcias"), "typo");
  assert.equal(classifyMistake("hola", "hola"), null, "no mistake");
  assert.equal(classifyMistake("hola", "adiós"), null, "unrelated is not a classified mistake");
});

test("diffWords marks which words were right, wrong, missing or extra", () => {
  const d = diffWords("yo quiero agua", "yo bebo agua");
  const byStatus = d.reduce((acc, x) => { acc[x.status] = (acc[x.status] ?? 0) + 1; return acc; }, {});
  assert.equal(byStatus.ok, 2, "yo and agua are right");
  assert.equal(byStatus.wrong, 1, "bebo is wrong");

  const extra = diffWords("quiero agua", "yo quiero agua");
  assert.ok(extra.some((x) => x.status === "extra"), "the added 'yo' is flagged extra");
  assert.ok(extra.some((x) => x.status === "ok"));
});

test("diffWords on an identical answer is all ok", () => {
  const d = diffWords("yo quiero agua", "yo quiero agua");
  assert.ok(d.every((x) => x.status === "ok"));
  assert.equal(d.length, 3);
});

// ---------------------------------------------------------------- every course

test("forgiveness works in every shipped language's spelling", () => {
  // Accents differ per language, so the "missing accents" case must work for all of them.
  const cases = [
    ["es", "cómo estás", "como estas"],
    ["fr", "où est la gare", "ou est la gare"],
    ["de", "ich heiße", "ich heisse"],
    ["it", "il caffè", "il caffe"],
    ["nb", "jeg forstår ikke", "jeg forstar ikke"],
    ["sv", "jag förstår inte", "jag forstar inte"],
  ];
  for (const [lang, expected, given] of cases) {
    const r = grade({ type: "translate", answer: expected, accepted: [expected] }, given, { lang });
    assert.equal(r.correct, true, `${lang}: "${given}" should be accepted for "${expected}"`);
    assert.equal(r.mistake, "accents", `${lang} should be classified as an accent slip`);
  }
});

test("the forgiving grader never accepts a different word", () => {
  // A guard against the whole feature going too far: real vocabulary must still be required.
  const pairs = [
    ["es", "el gato", "el perro"],
    ["fr", "le fromage", "le pain"],
    ["de", "die Milch", "das Brot"],
    ["it", "la mela", "il latte"],
    ["nb", "kaffen", "ølet"],
    ["sv", "fisken", "bären"],
  ];
  for (const [lang, expected, given] of pairs) {
    const r = grade({ type: "translate", answer: expected, accepted: [expected] }, given, { lang });
    assert.equal(r.correct, false, `${lang}: "${given}" must not pass for "${expected}"`);
  }
});
