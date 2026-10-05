# 🦜 Parroto

**Learn a language by parroting it back.**

A fully-featured language-learning app — the whole Duolingo loop, rebuilt from scratch with
**zero dependencies**. Node's built-in SQLite, HTTP server and test runner are all it uses, so
`npm install` is not part of the setup.

```bash
cd parroto
npm start          # → http://localhost:5175
```

Create an account with any username and a password of 6+ characters. That is the entire setup.

### Requirements

**Node 22.5 or newer** — Parroto uses Node's built-in `node:sqlite`.

On Node 22.5–23.3 that module is behind the `--experimental-sqlite` flag, so the launcher
(`bin/parroto.mjs`) detects this and adds the flag for you. You do not need to do anything.
On Node 23.4+ it is available with no flag.

```bash
npm run doctor     # checks your Node and tells you exactly what it found
```

Example output on a Node that needs the flag:

```
Parroto environment check
  node          22.12.0
  executable    D:\Program Files\nodejs\node.exe
  platform      win32-x64
  node:sqlite   available with --experimental-sqlite

✅ This Node can run Parroto — the launcher adds the flag for you.
```

If your Node is older than 22.5, `npm start` prints the exact upgrade commands for your platform
rather than failing with a stack trace.

> Avoid `npm run reset` / `npm run seed -- --reset` while the server is running — SQLite holds the
> file open. The tool tells you so instead of throwing `EBUSY`.

---

## What it does

| The Duolingo loop | In Parroto |
|---|---|
| Course path with locked skills | 4 courses, skills unlock in order, 5 levels each |
| Crowns | Every level of a skill earns a crown; mastering it unlocks the next skill |
| Hearts | 5 hearts, one lost per mistake in a lesson, refill with gems or 30-min regeneration |
| Streaks | Day-based, with longest-streak tracking and purchasable streak freezes |
| XP & daily goal | Per-lesson XP weighted by accuracy and combo, with a daily target |
| Gems | Earned from quests, spent on heart refills and streak freezes |
| Leaderboard leagues | Weekly XP board, top 3 promote, bottom 3 demote, 8 leagues |
| Daily quests | 3 rotating quests per day, claimable for gems |
| Achievements | 10 achievements driven by real totals |
| Stories | Dialogue with comprehension questions, unlocked by progress |
| Grammar tips | Per-skill notes behind the 📖 button, authored alongside the vocabulary |
| Spaced repetition | SM-2 style scheduler deciding what to review and when |

## Every exercise type

All thirteen, generated automatically from vocabulary — you author words, not exercises.

| Type | What the learner does |
|---|---|
| `translate` | Type the translation of a sentence |
| `word_bank` | Assemble a sentence from scrambled word tiles |
| `select_translation` | Choose which option means the prompt |
| `select_image` | Choose the picture matching a word |
| `listen_select` | Hear a word, tap which one it was |
| `listen_type` | Hear a sentence and type it (dictation) |
| `speak` | Say it out loud, graded from a speech transcript |
| `match_pairs` | Tap pairs to connect words in both languages |
| `fill_blank` | Complete a sentence with the missing word |
| `order_words` | Put the words in the correct order |
| `identify_character` | Name the letter being pronounced |
| `story` | Read a dialogue and answer comprehension questions |
| `review_mistake` | A failed exercise, re-served at the end of the session |

Grading is deliberately human, matching how the real product behaves:

- Missing accents still counts as correct — but scores lower.
- **A nearby word swapped** ("quiero yo agua" for "yo quiero agua") is accepted as a near miss.
- **A typo** is forgiven, with the correction shown: transpositions always, and one inserted or
  dropped letter on an ordinary-length word.
- **A stray or missing article** ("quiero agua" for "yo quiero agua") is accepted.
- Speech recognition is tolerated at roughly 30% word error, and a recogniser mangling a short
  word is never held against the learner.
- Practice sessions cost no hearts; lessons and stories do.

Forgiveness is bounded on purpose. A **substitution** on a short word is *not* accepted — that is
exactly how "gato" becomes "pato", and accepting it would teach the wrong vocabulary. Dropping a
negation (`no`, `nicht`, `inte`) always fails. Every typo rule has a matching rejection test.

### Help that teaches, not just reveals

Every exercise has a **hint ladder** that starts gentle and ends with the answer:

| Rung | Translate | Word bank | Multiple choice |
|---|---|---|---|
| 1 | How many words | How many tiles | Remove a wrong option |
| 2 | Show the article | Show the first word | Remove another |
| 3 | Show first letters | Show the order | Show the answer |

The answer is only ever in the last rung, and taking it marks the attempt as hinted — you still
get credit, but the combo breaks, so the "perfect lesson" achievement stays meaningful. Hints are
served by the server, so the answer never reaches the browser until you ask for it.

### Sound

All audio is **synthesised in the browser** with the Web Audio API — no mp3s, nothing to
download, works offline. Correct answers climb in pitch as your combo grows; a perfect lesson
gets a longer fanfare than a merely passed one. Two independent toggles (server setting plus a
local sound-effects switch) and everything fails silently if the browser blocks audio.

### Feedback that shows where you went wrong

A wrong answer isn't just "Not quite" — it renders a **word-by-word diff** with the words you got
wrong struck through, so you can see the mistake instead of decoding it from a sentence.

## Courses

| Course | Skills | Words | Stories |
|---|---|---|---|
| 🇪🇸 Spanish | 7 | 72 | 2 |
| 🇳🇴 Norwegian | 7 | 71 | 2 |
| 🇸🇪 Swedish | 7 | 71 | 2 |
| 🇩🇪 German | 3 | 24 | — |
| 🇮🇹 Italian | 4 | 37 | — |
| 🇫🇷 French | 3 | 26 | 1 |

Every course reaches **11/11 exercise types**. Switch between them any time — from the course
button on the Learn screen, or from Profile. Each course keeps its own skills, crowns, XP and
review schedule, so you never lose progress by switching.

**All content is original**, written for this project. It follows Duolingo's *shape* — greeting
first, then food, family, animals, travel, phrases — but none of it is copied from Duolingo's
copyrighted course material.

Adding a language is a data-only change: append to `COURSES` in `src/content/courses.mjs` and
every exercise type, the SRS schedule, the course path and the stories pick it up automatically.

## Tests

```bash
npm test
```

**168 tests, no network, no browser, no fixtures** — an in-memory SQLite database per test.
Verified passing on both Node 22.12 (with the flag, added automatically) and Node 26.

- `tests/core.test.mjs` — grading of every exercise type, the SRS scheduler, streak/heart
  arithmetic, exercise generation, and content validation.
- `tests/forgiving.test.mjs` — the typo/word-swap tolerance, in both directions: every accepted
  mistake has a matching rejected one, in all six languages' spelling.
- `tests/hints.test.mjs` — the hint ladder: the answer is only in the last rung, choices eliminate
  rather than reveal, and every generated exercise in every course has a usable ladder.
- `tests/service.test.mjs` — the real service: register → enrol → play a lesson → level a
  skill → unlock the next one. Includes a full course completed end to end.
- `tests/http.test.mjs` — real HTTP against a real socket: auth, routing, error codes, and a
  whole lesson played over the wire.
- `tests/preflight.test.mjs` — the Node-compatibility launcher: it must detect a Node that needs
  `--experimental-sqlite`, never duplicate the flag, and actually bind a port.

Two audit tools back the tests up:

```bash
npm run audit           # does every course really offer every feature?
npm run verify:grading  # does a typo survive a real session end to end?
```

`npm run audit` answers the "is it actually wired up?" question per course: exercise types
reachable (11/11), speaking served in a real session, hints on every exercise, and typo tolerance
in that language. It exists because a feature can be fully implemented, fully unit-tested, and
still never appear — speaking was, until the audit caught it.

Three tests exist specifically because they caught real bugs:

- *answers are never leaked to the client* — a `correct` flag was shipping to the browser,
  handing the answer to anyone who opened devtools.
- *failing everything still ends the session* — a failed retry was re-queued as another retry,
  so an all-wrong session could never terminate.
- *the next exercise is held until Continue* — the following question rendered behind the
  feedback bar, and the progress counter jumped a question ahead.

## Layout

```
bin/
  parroto.mjs            launcher: Node compatibility check, then start the server
  run-tests.mjs          test launcher (globs + the sqlite flag)
src/
  preflight.mjs          node:sqlite capability detection
  core/exercises.mjs     exercise types + grading (pure, no I/O)
  core/hints.mjs         the hint ladder (pure)
  core/srs.mjs           SM-2 spaced repetition scheduler (pure)
  core/gamification.mjs  XP, streaks, hearts, leagues, quests, achievements (pure)
  core/generator.mjs     vocabulary item → every exercise type
  content/courses.mjs    the courses and stories (data)
  content/courses/       drop-in courses: course-<id>.mjs exporting COURSE (+ optional STORIES)
  content/course-import.mjs  TSV → course objects for the bulk importer (pure)
  db.mjs                 SQLite schema
  service.mjs            business logic over the database
  server.mjs             HTTP router + static files
public/
  index.html  app.js  sound.js  styles.css      the client, no build step
tests/                 182 tests
tools/
  seed.mjs               create a demo account with progress
  validate-content.mjs   check every course for structural problems
  import-course.mjs      build a course module from a TSV of vocabulary
  audit-features.mjs     prove every course offers every feature
  verify-forgiving.mjs   prove typo tolerance survives a real session
```

The layering matters: `core/` is pure functions with no database, no HTTP and no DOM, which is
why grading, hints and scheduling are cheap to test exhaustively. `service.mjs` holds every rule
that needs the database. `server.mjs` is a thin router that delegates.

## API

The client is one consumer of a plain JSON API; you can drive the whole app from anywhere.

```bash
# register
curl -s localhost:5175/api/register -H 'content-type: application/json' \
  -d '{"username":"me","password":"secret123"}'

# start a lesson, then answer it
curl -s localhost:5175/api/lessons -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"courseId":"es-en","skillId":"es-basics-1","kind":"lesson"}'

curl -s localhost:5175/api/lessons/$SESSION/answer -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"exerciseId":"...","answer":"hola"}'
```

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health`, `/api/meta` | Liveness; courses, leagues, limits (public) |
| `POST` | `/api/register`, `/api/login`, `/api/logout` | Accounts |
| `GET`/`PATCH` | `/api/me` | Profile and settings |
| `GET` | `/api/home` | Everything the home screen needs, in one call |
| `GET` | `/api/courses`, `/api/courses/:id` | The course tree with crowns and unlock state |
| `POST` | `/api/courses/:id/enrol`, `/:id/switch` | Start a course; make one the active course |
| `POST` | `/api/lessons` | Start a lesson, practice, review or story |
| `POST` | `/api/lessons/:id/answer` | Grade one answer, get the next exercise |
| `GET` | `/api/lessons/:id/exercise` | Which exercise to show now (desync recovery) |
| `GET`/`POST` | `/api/lessons/:id/hints`, `/:id/hint` | Preview the hint ladder; serve one rung |
| `GET` | `/api/quests`, `/api/achievements`, `/api/leaderboard`, `/api/stats` | Meta screens |
| `POST` | `/api/quests/:id/claim`, `/api/shop/hearts`, `/api/shop/streak-freeze` | Rewards and shop |

Answers are **never** sent to the client. `select_image` choices and story questions are
stripped of their `correct`/`answer` fields server-side, and there is a test asserting it.

## Notes and limitations

- **Speech** uses the browser's Web Speech API — no audio files ship, and the voice quality is
  whatever your OS provides. Speaking exercises fall back to typing when unsupported.
- **Images** are emoji, not illustrations. It keeps the app dependency-free, and it means the
  `select_image` exercises work without an asset pipeline.
- **Stories** exist for Spanish and French only; the other courses ship without them.
- **The leaderboard is single-player in practice** — ranks are real (per-week XP across users)
  but there is no matchmaking, so you mostly see yourself until other accounts play.
- Audio has no waveform or playback-speed control; listening exercises play once at 0.85× rate.
- No password reset, email verification, or social login — this is a local single-machine app.

## Tools

```bash
npm run seed        # create a demo account with realistic progress
npm run validate    # check every course's structure and report problems
```

`validate-content.mjs` catches the content bugs that are invisible in the UI: items with no
distractors, skills too small to teach, story answers missing from their own choices, and
duplicate ids.

### Adding a course from a spreadsheet

Write vocabulary in a spreadsheet, export it as tab-separated values with this header row:

```
skill	skill_title	skill_icon	skill_notes	target	source	note	alternatives	images
```

Only `skill`, `target` and `source` are required. `skill_title` is taken from the first
row that mentions a skill; `skill_notes` works the same way and becomes the grammar tips
behind the skill's 📖 button. `alternatives` and `images` hold `|`-separated lists; lines
starting with `#` are ignored. Each skill needs at least 5 items — that is the minimum
the validator accepts for generating distractors.

```bash
npm run import:course -- words.tsv \
  --id pt-en --name Portuguese --from English --to Portuguese \
  --flag "🇵🇹" --tts pt-PT --color "#009b3a"
```

The importer validates everything `npm run validate` would flag, so an imported course
passes first time. The generated module lands in `src/content/courses/` and is picked
up automatically — no registry edit; confirm with `npm run validate` and
`npm run audit`. Stories are still authored by hand: add a `STORIES` export to the
generated file. Pass `--check` to validate a TSV without writing anything, or `--out`
to write somewhere else (files outside `src/content/courses/` are ignored).
