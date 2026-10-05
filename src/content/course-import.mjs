/**
 * Parroto — course bulk importer (library).
 *
 * Authors write vocabulary in a spreadsheet, export it as tab-separated values, and this
 * module turns it into a course object shaped exactly like the hand-written ones in
 * `./courses.mjs`. The CLI in `tools/import-course.mjs` is a thin wrapper around it.
 *
 * TSV columns (header row required, tab-separated — a field never contains a tab):
 *
 *   skill | skill_title | skill_icon | target | source | note | alternatives | images
 *
 * Only `skill`, `target` and `source` are required. `skill_title` is read from the first
 * row that mentions a skill and inherited by later rows; a conflicting title is an error.
 * `alternatives` and `images` hold `|`-separated lists. Lines starting with `#` and blank
 * lines are ignored.
 */

import { normalise } from "../core/exercises.mjs";

export const COLUMNS = [
  "skill", "skill_title", "skill_icon", "target", "source", "note", "alternatives", "images",
];

const COURSE_ID = /^[a-z]{2,3}-[a-z]{2,3}$/;

/** Splits TSV text into row objects keyed by column name. Throws on a bad header. */
export function parseRows(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const rows = [];
  let header = null;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const cells = line.split("\t").map((c) => c.trim());
    if (!header) {
      const unknown = cells.filter((c) => !COLUMNS.includes(c));
      if (unknown.length) {
        throw new Error(`unknown column(s) ${unknown.join(", ")} — expected: ${COLUMNS.join(", ")}`);
      }
      for (const required of ["skill", "target", "source"]) {
        if (!cells.includes(required)) throw new Error(`missing required column "${required}"`);
      }
      header = cells;
      continue;
    }
    const row = { __line: n + 1 };
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i] ?? "";
    rows.push(row);
  }
  if (!header) throw new Error("no header row found");
  return rows;
}

/** URL-safe slug for item ids, mirroring the hand-written style (`es-como-estas`). */
export function slugFor(target) {
  return normalise(target, { keepAccents: false })
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "item";
}

function checkMeta(meta, errors) {
  for (const key of ["id", "name", "from", "to", "flag", "tts", "color"]) {
    if (!meta?.[key]) errors.push(`course metadata is missing "${key}"`);
  }
  if (meta?.id && !COURSE_ID.test(meta.id)) {
    errors.push(`course id "${meta.id}" should look like "pt-en" (language-course)`);
  }
  if (meta?.tts && !/^[a-z]{2}-[A-Z]{2}$/.test(meta.tts)) {
    errors.push(`tts voice "${meta.tts}" should be a language-REGION tag like "pt-BR"`);
  }
}

/**
 * Groups rows into a course object. Returns `{ course, errors, warnings }` — `course` is
 * null when errors make the output unusable. Anything `tools/validate-content.mjs` would
 * flag as a problem is an error here, so imported courses validate on the first run.
 */
export function buildCourse(meta, rows) {
  const errors = [];
  const warnings = [];
  checkMeta(meta, errors);
  if (!rows.length) errors.push("no vocabulary rows found");

  const prefix = String(meta?.id ?? "xx").split("-")[0];
  const skills = new Map();
  const usedIds = new Set();

  for (const row of rows) {
    const where = `line ${row.__line}`;
    if (!row.skill) { errors.push(`${where}: missing skill`); continue; }
    if (!row.target) { errors.push(`${where}: missing target text`); continue; }
    if (!row.source) { errors.push(`${where}: missing source text`); continue; }

    let skill = skills.get(row.skill);
    if (!skill) {
      skill = { id: row.skill, title: row.skill_title || row.skill, icon: row.skill_icon || "star", items: [] };
      skills.set(row.skill, skill);
    } else {
      if (row.skill_title && row.skill_title !== skill.title) {
        errors.push(`${where}: skill "${row.skill}" already titled "${skill.title}"`);
        continue;
      }
      if (row.skill_icon && row.skill_icon !== skill.icon) {
        errors.push(`${where}: skill "${row.skill}" already uses icon "${skill.icon}"`);
        continue;
      }
    }

    const key = normalise(row.target);
    if (skill.items.some((i) => normalise(i.target) === key)) {
      errors.push(`${where}: skill "${row.skill}" teaches "${row.target}" twice`);
      continue;
    }
    if (!/[a-zA-ZÀ-ÿ]/.test(row.target)) {
      errors.push(`${where}: target "${row.target}" has no letters`);
      continue;
    }

    let id = `${prefix}-${slugFor(row.target)}`;
    for (let n = 2; usedIds.has(id); n++) id = `${prefix}-${slugFor(row.target)}-${n}`;
    usedIds.add(id);

    const item = { id, target: row.target, source: row.source };
    const alternatives = splitList(row.alternatives);
    if (alternatives.length) {
      item.alternatives = alternatives;
      const strip = (s) => String(s).replace(/[¿?¡!.,;:]+$/g, "").trim().toLowerCase();
      for (const alt of alternatives) {
        if (strip(alt) === strip(row.target)) {
          warnings.push(`${where}: item "${row.target}" lists its own target as an alternative ("${alt}")`);
        }
      }
    }
    const images = splitList(row.images);
    if (images.length) item.images = images;
    if (row.note) item.note = row.note;
    skill.items.push(item);
  }

  for (const skill of skills.values()) {
    if (skill.items.length > 0 && skill.items.length < 5) {
      errors.push(`skill "${skill.id}" has only ${skill.items.length} item(s); add at least 5`);
    }
  }

  if (errors.length) return { course: null, errors, warnings };
  return {
    course: {
      id: meta.id,
      name: meta.name,
      from: meta.from,
      to: meta.to,
      flag: meta.flag,
      tts: meta.tts,
      color: meta.color,
      skills: [...skills.values()],
    },
    errors,
    warnings,
  };
}

function splitList(value) {
  return String(value ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Renders a course object as an importable JS module exporting `varName`. */
export function renderCourseModule(varName, course, { argv = "node tools/import-course.mjs" } = {}) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(varName ?? "")) {
    throw new Error(`varName "${varName}" must be UPPER_SNAKE_CASE`);
  }
  const date = new Date().toISOString().slice(0, 10);
  return (
    `/**\n` +
    ` * ${course.name} (${course.id}) — generated ${date}; do not hand-edit.\n` +
    ` * Regenerate with \`${argv}\`, then re-run \`npm run validate\`.\n` +
    ` * Drop-in file: anything exporting COURSE in src/content/courses/ is picked up\n` +
    ` * automatically. An optional STORIES export ([...]) attaches dialogue stories.\n` +
    ` */\n\n` +
    `export const ${varName} = ${JSON.stringify(course, null, 2)};\n`
  );
}
