/**
 * Parroto — database layer.
 *
 * Uses Node's built-in SQLite (node:sqlite), so the whole app has zero dependencies.
 * The schema is created on first boot and migrated forward by `schema_version`.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA_VERSION = 1;

const DDL = `
-- ---------------------------------------------------------------- users
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  display_name  TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,

  -- gamification
  xp            INTEGER NOT NULL DEFAULT 0,
  gems          INTEGER NOT NULL DEFAULT 0,
  hearts        INTEGER NOT NULL DEFAULT 5,
  hearts_updated_at INTEGER NOT NULL DEFAULT 0,
  streak        INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_practice_day TEXT,             -- 'YYYY-MM-DD' in the user's local day
  daily_goal    INTEGER NOT NULL DEFAULT 20,   -- XP target per day
  daily_xp      INTEGER NOT NULL DEFAULT 0,
  daily_xp_day  TEXT,
  streak_freezes INTEGER NOT NULL DEFAULT 0,
  freeze_used_day TEXT,

  -- cosmetics / profile
  avatar        TEXT NOT NULL DEFAULT 'parrot',
  profile_public INTEGER NOT NULL DEFAULT 1,
  leaderboard_optin INTEGER NOT NULL DEFAULT 1,
  sound_enabled INTEGER NOT NULL DEFAULT 1,
  speaking_enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- ------------------------------------------------------------- courses
CREATE TABLE IF NOT EXISTS user_courses (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id     TEXT    NOT NULL,
  learning      INTEGER NOT NULL DEFAULT 1,   -- 1 = learning, 0 = just browsing
  xp            INTEGER NOT NULL DEFAULT 0,
  crowns        INTEGER NOT NULL DEFAULT 0,
  started_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, course_id)
);

-- Per-skill progress within a course.
CREATE TABLE IF NOT EXISTS skill_progress (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id   TEXT    NOT NULL,
  skill_id    TEXT    NOT NULL,
  level       INTEGER NOT NULL DEFAULT 0,   -- 0 = locked, 1..5 = completed levels
  crowns      INTEGER NOT NULL DEFAULT 0,   -- == level, kept explicit for clarity
  unlocked    INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  PRIMARY KEY (user_id, course_id, skill_id)
);

-- --------------------------------------------------- spaced repetition
-- One row per (user, course, item). Drives what the review queue serves.
CREATE TABLE IF NOT EXISTS srs_items (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id    TEXT    NOT NULL,
  item_id      TEXT    NOT NULL,
  skill_id     TEXT    NOT NULL,
  -- SM-2 style scheduling state
  ease         REAL    NOT NULL DEFAULT 2.5,
  interval_days REAL   NOT NULL DEFAULT 0,
  reps         INTEGER NOT NULL DEFAULT 0,
  lapses       INTEGER NOT NULL DEFAULT 0,
  due_at       INTEGER NOT NULL,
  last_seen    INTEGER,
  last_grade   INTEGER,          -- 0..3 (again/hard/good/easy) of the last answer
  PRIMARY KEY (user_id, course_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_srs_due ON srs_items (user_id, course_id, due_at);

-- ------------------------------------------------------------- lessons
CREATE TABLE IF NOT EXISTS lesson_sessions (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id   TEXT NOT NULL,
  skill_id    TEXT,                 -- null for course-wide review and story sessions
  kind        TEXT NOT NULL,        -- lesson | practice | review | story
  state       TEXT NOT NULL,        -- json: current queue, index, hearts, mistakes
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  passed      INTEGER,
  xp_awarded  INTEGER NOT NULL DEFAULT 0,
  summary     TEXT                  -- json: the results payload, so it can be re-read
);

CREATE TABLE IF NOT EXISTS lesson_answers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES lesson_sessions(id) ON DELETE CASCADE,
  item_id    TEXT NOT NULL,
  exercise   TEXT NOT NULL,
  correct    INTEGER NOT NULL,
  user_answer TEXT,
  ms         INTEGER NOT NULL DEFAULT 0,
  at         INTEGER NOT NULL
);

-- -------------------------------------------------------------- social
CREATE TABLE IF NOT EXISTS friendships (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);

CREATE TABLE IF NOT EXISTS leaderboard (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week       TEXT NOT NULL,        -- ISO week 'YYYY-Www'
  xp         INTEGER NOT NULL DEFAULT 0,
  league     TEXT NOT NULL DEFAULT 'bronze',
  PRIMARY KEY (user_id, week)
);

-- --------------------------------------------------------------- quests
CREATE TABLE IF NOT EXISTS quests (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  quest_id   TEXT NOT NULL,
  progress   INTEGER NOT NULL DEFAULT 0,
  goal       INTEGER NOT NULL,
  claimed    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, quest_id)
);

-- --------------------------------------------------------------- misc
CREATE TABLE IF NOT EXISTS achievements (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement  TEXT NOT NULL,
  unlocked_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, achievement)
);

CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  kind    TEXT NOT NULL,
  data    TEXT,
  at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** Opens (and creates) the database at `path`, applying the schema. */
export function openDatabase(path = "data/parroto.db") {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(DDL);

  const current = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  if (!current) {
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)")
      .run(String(SCHEMA_VERSION));
  } else if (Number(current.value) !== SCHEMA_VERSION) {
    // Only version 1 exists so far; a real migration chain would run here.
    db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'")
      .run(String(SCHEMA_VERSION));
  }
  return db;
}

export { SCHEMA_VERSION };
