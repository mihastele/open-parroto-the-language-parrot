/**
 * Parroto — drop-in course loading tests.
 *
 * Covers the auto-loader that picks up `course-*.mjs` files without a registry edit:
 * ordering, stories merging, and every rejection with the offending filename. Fixtures
 * live in temporary directories, never in src/content/courses/, where they would become
 * real courses and leak into every other suite.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadExtraCourses } from "../src/content/courses.mjs";

function dir() {
  return mkdtempSync(join(tmpdir(), "parroto-courses-"));
}

function writeCourse(dirPath, file, id, { stories = null, broken = false } = {}) {
  const course = broken
    ? `export const NOT_A_COURSE = {};`
    : `export const COURSE = ${JSON.stringify({ id, name: id, from: "English", to: id, flag: "🏳️", tts: "en-US", color: "#fff", skills: [] })};` +
      (stories ? `\nexport const STORIES = ${JSON.stringify(stories)};` : "");
  writeFileSync(join(dirPath, file), course + "\n");
}

test("a missing or empty directory means no extra courses", async () => {
  assert.deepEqual(await loadExtraCourses(join(dir(), "nope")), { courses: [], stories: {} });
  assert.deepEqual(await loadExtraCourses(dir()), { courses: [], stories: {} });
});

test("only course-*.mjs files load, in filename order", async () => {
  const d = dir();
  writeFileSync(join(d, "notes.txt"), "not a course");
  writeFileSync(join(d, "other.mjs"), "export const COURSE = { id: 'zz', skills: [] };");
  writeCourse(d, "course-b.mjs", "b-en");
  writeCourse(d, "course-a.mjs", "a-en");
  const { courses } = await loadExtraCourses(d);
  assert.deepEqual(courses.map((c) => c.id), ["a-en", "b-en"]);
});

test("stories merge under their course id", async () => {
  const d = dir();
  writeCourse(d, "course-a.mjs", "a-en", { stories: [{ id: "s1" }] });
  const { stories } = await loadExtraCourses(d);
  assert.deepEqual(stories, { "a-en": [{ id: "s1" }] });
});

test("broken files fail with their filename", async () => {
  const d = dir();
  writeCourse(d, "course-bad.mjs", "bad-en", { broken: true });
  await assert.rejects(() => loadExtraCourses(d), /course-bad\.mjs: must export COURSE/);

  const d2 = dir();
  writeFileSync(join(d2, "course-x.mjs"),
    `export const COURSE = { id: "x-en", skills: [] };\nexport const STORIES = {};\n`);
  await assert.rejects(() => loadExtraCourses(d2), /course-x\.mjs: STORIES must be an array/);
});

test("duplicate ids are refused, against built-ins and between files", async () => {
  const d = dir();
  writeCourse(d, "course-dup.mjs", "es-en");
  await assert.rejects(() => loadExtraCourses(d, ["es-en"]), /duplicate course id "es-en"/);

  const d2 = dir();
  writeCourse(d2, "course-one.mjs", "same-en");
  writeCourse(d2, "course-two.mjs", "same-en");
  await assert.rejects(() => loadExtraCourses(d2), /course-two\.mjs: duplicate course id/);
});

test("built-ins load unchanged when no drop-in directory exists", async () => {
  const { COURSES } = await import("../src/content/courses.mjs");
  assert.deepEqual(
    COURSES.map((c) => c.id).sort(),
    ["de-en", "es-en", "fr-en", "it-en", "nb-en", "sv-en"],
  );
});
