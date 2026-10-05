/**
 * Parroto — bulk importer tests.
 *
 * Covers the TSV → course pipeline that new course data flows through: parsing, id
 * generation, grouping, and the validation that guarantees `npm run validate` passes on
 * the first run. The generated module is imported for real, so a broken render fails here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseRows, buildCourse, renderCourseModule } from "../src/content/course-import.mjs";

const META = {
  id: "pt-en", name: "Portuguese", from: "English", to: "Portuguese",
  flag: "🇵🇹", tts: "pt-PT", color: "#009b3a",
};

const HEADER = "skill\tskill_title\tskill_icon\ttarget\tsource\tnote\talternatives\timages";

function tsv(...body) {
  return [HEADER, ...body].join("\n");
}

function basicsRows() {
  return tsv(
    "basics\tBasics 1\tchat\tolá\thello\tA greeting.\t\t👋",
    "basics\t\t\tobrigado\tthank you\t\t\t🙏",
    "basics\t\t\tágua\twater\t\t\t💧",
    "basics\t\t\tpão\tbread\t\t\t🍞",
    "basics\t\t\tsim\tyes\t\t\t✅",
  );
}

test("parsing skips comments and blank lines", () => {
  const rows = parseRows(`# a comment\n\n${basicsRows()}\n`);
  assert.equal(rows.length, 5);
  assert.equal(rows[0].skill, "basics");
  assert.equal(rows[0].target, "olá");
});

test("parsing rejects unknown or missing columns", () => {
  assert.throws(() => parseRows("skill\ttarget\tbogus\na\tb\tc"), /unknown column/);
  assert.throws(() => parseRows("skill\ttarget\na\tb"), /missing required column "source"/);
  assert.throws(() => parseRows("# only a comment\n"), /no header row/);
});

test("building groups rows into skills and derives stable ids", () => {
  const { course, errors } = buildCourse(META, parseRows(basicsRows()));
  assert.deepEqual(errors, []);
  assert.equal(course.skills.length, 1);
  assert.equal(course.skills[0].title, "Basics 1");
  assert.equal(course.skills[0].icon, "chat");
  assert.equal(course.skills[0].items[0].id, "pt-ola");
  assert.deepEqual(course.skills[0].items[0].images, ["👋"]);
  assert.equal(course.skills[0].items[1].note, undefined);
});

test("building rejects unusable content with clear errors", () => {
  // Duplicate target in one skill.
  const dup = parseRows(tsv(
    "s\tT\ti\thello\tx", "s\tT\ti\thello\ty", "s\tT\ti\ta\tb", "s\tT\ti\tc\td", "s\tT\ti\te\tf",
  ));
  assert.match(buildCourse(META, dup).errors.join("\n"), /teaches "hello" twice/);

  // Too few items for the validator's minimum.
  const short = parseRows(tsv("s\tT\ti\thello\tx"));
  assert.match(buildCourse(META, short).errors.join("\n"), /only 1 item/);

  // Conflicting skill titles and missing metadata.
  const conflict = parseRows(tsv(
    "s\tOne\ti\ta\tb", "s\tTwo\ti\tc\td", "s\tOne\ti\te\tf", "s\tOne\ti\tg\th", "s\tOne\ti\tj\tk",
  ));
  assert.match(buildCourse(META, conflict).errors.join("\n"), /already titled/);
  assert.match(buildCourse({ ...META, id: undefined }, parseRows(basicsRows())).errors.join("\n"), /missing "id"/);
  assert.match(buildCourse({ ...META, tts: "portuguese" }, parseRows(basicsRows())).errors.join("\n"), /language-REGION/);
});

test("identical targets in different skills get unique ids", () => {
  const { course, errors } = buildCourse(META, parseRows(tsv(
    "s1\tOne\ti\thello\ta", "s1\tOne\ti\tb\tc", "s1\tOne\ti\td\te", "s1\tOne\ti\tf\tg", "s1\tOne\ti\th\ti",
    "s2\tTwo\ti\thello\tj", "s2\tTwo\ti\tk\tl", "s2\tTwo\ti\tm\tn", "s2\tTwo\ti\to\tp", "s2\tTwo\ti\tq\tr",
  )));
  assert.deepEqual(errors, []);
  const ids = course.skills.flatMap((s) => s.items.map((i) => i.id));
  assert.equal(new Set(ids).size, ids.length);
});

test("skill_notes become the skill's grammar tips", () => {
  const header = "skill\tskill_title\tskill_icon\tskill_notes\ttarget\tsource\tnote\talternatives\timages";
  const body = (first, second = "") => [
    header,
    `s\tT\ti\t${first}\ta\tb`,
    `s\tT\ti\t${second}\tc\td`,
    "s\tT\ti\t\te\tf",
    "s\tT\ti\t\tg\th",
    "s\tT\ti\t\tj\tk",
  ].join("\n");

  const good = buildCourse(META, parseRows(body("First paragraph.\\n\\nSecond paragraph, long enough.")));
  assert.deepEqual(good.errors, []);
  assert.equal(good.course.skills[0].notes, "First paragraph.\n\nSecond paragraph, long enough.");

  const repeat = buildCourse(META, parseRows(
    body("Same long notes here, repeated.", "Same long notes here, repeated.")));
  assert.deepEqual(repeat.errors, [], "repeating identical notes is fine");

  const conflict = buildCourse(META, parseRows(
    body("First version of the notes, long.", "Totally different notes, long enough.")));
  assert.match(conflict.errors.join("\n"), /already has different notes/);

  const short = buildCourse(META, parseRows(body("Too short.")));
  assert.match(short.errors.join("\n"), /notes too short/);

  const plain = buildCourse(META, parseRows(basicsRows()));
  assert.equal(plain.course.skills[0].notes, undefined, "no column means no notes");
});

test("rendered module imports and carries the course", async () => {
  const { course } = buildCourse(META, parseRows(basicsRows()));
  const dir = mkdtempSync(join(tmpdir(), "parroto-import-"));
  const file = join(dir, "course-pt-en.mjs");
  writeFileSync(file, renderCourseModule("PORTUGUESE", course));
  const mod = await import(pathToFileURL(file).href);
  assert.equal(mod.PORTUGUESE.id, "pt-en");
  assert.equal(mod.PORTUGUESE.skills[0].items.length, 5);
  assert.throws(() => renderCourseModule("portuguese", course), /UPPER_SNAKE_CASE/);
});
