/**
 * Parroto — course bulk importer.
 *
 * Turns a spreadsheet of vocabulary (exported as TSV) into a course module ready to wire
 * into src/content/courses.mjs:
 *
 *   node tools/import-course.mjs words.tsv \
 *     --id pt-en --name Portuguese --from English --to Portuguese \
 *     --flag "🇵🇹" --tts pt-PT --color "#009b3a" [--out <file.mjs>] [--check]
 *
 * The module lands in src/content/courses/ (or --out) exporting COURSE, and is picked up
 * automatically — no registry edit. TSV columns (header row required):
 *   skill | skill_title | skill_icon | skill_notes | target | source | note | alternatives | images
 *
 * `alternatives` and `images` hold `|`-separated lists. Lines starting with `#` and blank
 * lines are ignored. With `--check` nothing is written; the input is only validated.
 *
 * Anything `npm run validate` would flag as a problem is an error here, so an imported
 * course validates on the first run. Stories are still authored by hand in courses.mjs.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseRows, buildCourse, renderCourseModule } from "../src/content/course-import.mjs";

function usage() {
  console.error("");
  console.error("  node tools/import-course.mjs <words.tsv>");
  console.error("      --id <xx-yy> --name <Name> --from <English> --to <Language>");
  console.error('      --flag <emoji> --tts <xx-YY> --color <#hex> [--out <file.mjs>] [--check]');
  console.error("");
}

function parseArgs(argv) {
  const args = { flags: {} };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (key === "check") { args.flags.check = true; continue; }
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) {
        console.error(`❌ --${key} needs a value`);
        usage();
        process.exit(1);
      }
      args.flags[key] = value;
    } else {
      positional.push(a);
    }
  }
  args.input = positional[0];
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.input) {
  console.error("❌ need an input TSV");
  usage();
  process.exit(1);
}

const { id, name, from, to, flag, tts, color } = args.flags;
const meta = { id, name, from, to, flag, tts, color };

let rows;
try {
  rows = parseRows(readFileSync(args.input, "utf8"));
} catch (err) {
  console.error(`❌ ${args.input}: ${err.message}`);
  process.exit(1);
}

const { course, errors, warnings } = buildCourse(meta, rows);
for (const w of warnings) console.error(`⚠️  ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`❌ ${e}`);
  console.error(`\nFAILED — ${errors.length} problem(s), nothing written.`);
  process.exit(1);
}

const varName = args.flags.var ??
  (String(name ?? "COURSE").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") ||
    "COURSE");
const module = renderCourseModule("COURSE", course, {
  argv: `node tools/import-course.mjs ${process.argv.slice(2).join(" ")}`,
});
const itemCount = course.skills.reduce((n, s) => n + s.items.length, 0);

if (args.flags.check) {
  console.log(`✅ ${course.skills.length} skill(s), ${itemCount} item(s) — nothing written (--check).`);
  process.exit(0);
}

const out = args.flags.out ?? join("src", "content", "courses", `course-${course.id}.mjs`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, module);
console.log(`✅ wrote ${out}: ${course.skills.length} skill(s), ${itemCount} item(s).`);
console.log(`   It is picked up automatically — run \`npm run validate\` and \`npm run audit\`.`);
