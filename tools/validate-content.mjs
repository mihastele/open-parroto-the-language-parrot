/**
 * Parroto — content validator.
 *
 * Checks the shipped courses for the structural problems that are invisible in the UI:
 * items too short to generate distractors, skills too small to teach, stories whose answers
 * are not among their own choices, duplicate ids, and exercise types the content can never
 * produce. Run with `npm run validate`.
 */

import { COURSES, allItems, storiesFor, getCourse } from "../src/content/courses.mjs";
import { EXERCISE_TYPES, exercisePlanFor, normalise } from "../src/core/exercises.mjs";
import { buildExercise, buildLesson } from "../src/core/generator.mjs";

const problems = [];
const warnings = [];
const report = [];

function problem(course, msg) { problems.push(`${course}: ${msg}`); }
function warn(course, msg) { warnings.push(`${course}: ${msg}`); }

/** How many distinct exercise types a whole course can actually produce. */
function producibleTypes(course) {
  const produced = new Set();
  for (const skill of course.skills) {
    const items = skill.items.map((i) => ({ ...i, skillId: skill.id }));
    for (const item of items) {
      for (const type of exercisePlanFor(item, { speaking: true })) {
        const ex = buildExercise(item, type, items, { seed: 1, tts: course.tts, toName: course.to });
        if (ex) produced.add(type);
      }
    }
  }
  return produced;
}

report.push("Parroto content validation");
report.push("=".repeat(60));

for (const course of COURSES) {
  report.push("");
  report.push(`${course.flag} ${course.name} (${course.id}) — ${course.from} → ${course.to}`);

  // ---- metadata
  for (const key of ["id", "name", "from", "to", "flag", "tts", "color"]) {
    if (!course[key]) problem(course.id, `missing course metadata: ${key}`);
  }
  if (!/^[a-z]{2}-[A-Z]{2}$/.test(course.tts)) {
    warn(course.id, `tts voice "${course.tts}" is not a language-REGION tag`);
  }

  // ---- ids are globally unique
  const seenItems = new Map();
  const seenSkills = new Set();

  for (const skill of course.skills) {
    if (seenSkills.has(skill.id)) problem(course.id, `duplicate skill id ${skill.id}`);
    seenSkills.add(skill.id);

    if (!skill.title) problem(course.id, `skill ${skill.id} has no title`);
    if (!skill.icon) warn(course.id, `skill ${skill.id} has no icon`);
    if (skill.notes !== undefined &&
        (typeof skill.notes !== "string" || skill.notes.trim().length < 20)) {
      problem(course.id, `skill ${skill.id} has notes too short to teach anything`);
    }
    if (skill.items.length < 5) {
      problem(course.id, `skill ${skill.id} has only ${skill.items.length} items; too few to teach`);
    }

    // ---- items
    const targets = new Set();
    for (const item of skill.items) {
      if (!item.id) problem(course.id, `an item in ${skill.id} has no id`);
      if (!item.target) problem(course.id, `item ${item.id} has no target text`);
      if (!item.source) problem(course.id, `item ${item.id} has no source text`);
      if (seenItems.has(item.id)) {
        problem(course.id, `duplicate item id ${item.id} (also in ${seenItems.get(item.id)})`);
      }
      seenItems.set(item.id, skill.id);

      const key = normalise(item.target);
      if (targets.has(key)) {
        problem(course.id, `skill ${skill.id} teaches "${item.target}" twice`);
      }
      targets.add(key);

      // A target with no letters would break word/letter exercises.
      if (!/[a-zA-ZÀ-ÿ]/.test(item.target)) {
        problem(course.id, `item ${item.id} target "${item.target}" has no letters`);
      }
      // Alternatives that duplicate the target are pointless. Compare exactly (keeping
      // accents and punctuation significance) — an accent-free variant is a genuinely
      // useful alternative, not a redundant one.
      for (const alt of item.alternatives ?? []) {
        const strip = (s) => String(s).replace(/[¿?¡!.,;:]+$/g, "").trim().toLowerCase();
        if (strip(alt) === strip(item.target)) {
          warn(course.id, `item ${item.id} lists its own target as an alternative ("${alt}")`);
        }
      }
    }

    // ---- every planned exercise must actually build
    const items = skill.items.map((i) => ({ ...i, skillId: skill.id }));
    for (const item of items) {
      for (const type of exercisePlanFor(item, { speaking: true })) {
        const ex = buildExercise(item, type, items, { seed: 1, tts: course.tts, toName: course.to });
        if (!ex) {
          // Declining because the skill lacks distractors is a content problem.
          problem(course.id,
            `${skill.id}/${item.id}: cannot build "${type}" — skill needs more items for distractors`);
        }
        if (ex && (!ex.directions || ex.directions.length < 3)) {
          problem(course.id, `${skill.id}/${item.id}: "${type}" has no usable directions`);
        }
      }
    }

    // ---- a lesson must be playable
    const lesson = buildLesson(items, { size: 8, seed: 1, speaking: true, tts: course.tts });
    if (lesson.length < 4) {
      problem(course.id, `skill ${skill.id} only produces ${lesson.length} exercises in a lesson`);
    }
    const types = new Set(lesson.map((e) => e.type));
    if (types.size < 3) {
      warn(course.id, `skill ${skill.id} lesson uses only ${types.size} exercise type(s)`);
    }
  }

  // ---- coverage: can this course reach every exercise type?
  const produced = producibleTypes(course);
  const expected = EXERCISE_TYPES.filter((t) => t !== "story" && t !== "review_mistake");
  const missing = expected.filter((t) => !produced.has(t));
  if (missing.length) {
    problem(course.id, `course can never generate: ${missing.join(", ")}`);
  }
  report.push(`   items ${allItems(course).length} · skills ${course.skills.length} · ` +
              `exercise types ${produced.size}/${expected.length}`);

  // ---- stories
  for (const story of storiesFor(course.id)) {
    if (!story.id || !story.title) problem(course.id, "a story is missing its id or title");
    if (!Array.isArray(story.lines) || story.lines.length < 3) {
      problem(course.id, `story ${story.id} has too little dialogue`);
    }
    for (const line of story.lines ?? []) {
      if (!line.speaker || !line.text || !line.en) {
        problem(course.id, `story ${story.id} has an incomplete line`);
      }
    }
    if (!story.questions?.length) problem(course.id, `story ${story.id} has no questions`);
    for (const q of story.questions ?? []) {
      if (!q.id || !q.q) problem(course.id, `story ${story.id} has a malformed question`);
      if (!Array.isArray(q.choices) || q.choices.length < 2) {
        problem(course.id, `story ${story.id}/${q.id} needs at least two choices`);
      }
      if (!q.choices?.includes(q.answer)) {
        problem(course.id, `story ${story.id}/${q.id}: the answer is not among the choices`);
      }
      if (new Set(q.choices).size !== q.choices.length) {
        problem(course.id, `story ${story.id}/${q.id} has duplicate choices`);
      }
    }
    if (typeof story.requiresSkills !== "number" || story.requiresSkills < 1) {
      warn(course.id, `story ${story.id} has no sensible unlock requirement`);
    } else if (story.requiresSkills > course.skills.length) {
      problem(course.id,
        `story ${story.id} needs ${story.requiresSkills} skills but the course has ${course.skills.length}`);
    }

    // A story should actually use the course's vocabulary, not float free of it.
    const vocab = new Set(allItems(course).map((i) => normalise(i.target)));
    const usedWords = story.lines.filter((l) =>
      [...vocab].some((v) => normalise(l.text).includes(v))).length;
    if (usedWords === 0) {
      problem(course.id, `story ${story.id} never uses any of the course's vocabulary`);
    } else if (usedWords < story.lines.length) {
      warn(course.id, `story ${story.id} has ${story.lines.length - usedWords} line(s) with no course vocabulary`);
    }
  }
  report.push(`   stories ${storiesFor(course.id).length}`);
}

// ---- cross-course
const courseIds = new Set();
for (const c of COURSES) {
  if (courseIds.has(c.id)) problem("all", `duplicate course id ${c.id}`);
  courseIds.add(c.id);
}
if (COURSES.length < 1) problem("all", "no courses ship at all");
if (getCourse("nope") !== null) problem("all", "getCourse should return null for an unknown id");

// ---- output
report.push("");
report.push("=".repeat(60));
if (warnings.length) {
  report.push(`⚠️  ${warnings.length} warning(s):`);
  for (const w of warnings) report.push(`   - ${w}`);
}
if (problems.length) {
  report.push(`❌ ${problems.length} problem(s):`);
  for (const p of problems) report.push(`   - ${p}`);
  report.push("");
  report.push("FAILED");
} else {
  report.push("✅ all courses valid" + (warnings.length ? ` (${warnings.length} warnings)` : ""));
}

console.log(report.join("\n"));
process.exit(problems.length ? 1 : 0);
