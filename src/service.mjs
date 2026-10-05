/**
 * Parroto — the learning service.
 *
 * Business logic that touches the database: accounts, course enrolment, skill unlocking,
 * starting and grading lesson sessions, SRS updates and gamification side effects.
 *
 * The HTTP layer is deliberately thin and delegates everything here, so this module can be
 * exercised directly from tests with an in-memory database.
 */

import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import {
  grade as gradeAnswer, exercisePlanFor, normalise,
} from "./core/exercises.mjs";
import { buildExercise, buildLesson } from "./core/generator.mjs";
import { hintPreview, hintStep } from "./core/hints.mjs";
import { schedule, freshItem, buildReviewQueue, strength } from "./core/srs.mjs";
import {
  MAX_HEARTS, HEART_REFILL_GEMS, STREAK_FREEZE_GEMS, dayKey, lessonXp, advanceStreak,
  addDailyXp, dailyGoalMet, regenerateHearts, minutesToNextHeart, heartsForMistake,
  dailyQuests, earnedAchievements, ACHIEVEMENTS, weekKey, nextLeague, leagueOutcome,
  comboTier, XP_PER_LEVEL_COMPLETE,
} from "./core/gamification.mjs";
import { COURSES, getCourse, getSkill, allItems, storiesFor, courseSummaries } from "./content/courses.mjs";

const MAX_SKILL_LEVEL = 5;
/** How many consecutive perfect levels are needed to earn each successive level of a skill. */
const LESSON_SIZE = 8;

// ---------------------------------------------------------------------- errors

export class AppError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
const badRequest = (msg, code = "bad_request") => new AppError(400, code, msg);
const unauthorized = (msg = "Not signed in") => new AppError(401, "unauthorized", msg);
const notFound = (msg = "Not found") => new AppError(404, "not_found", msg);

// ---------------------------------------------------------------------- passwords

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

// ---------------------------------------------------------------------- users

export class Service {
  constructor(db) {
    this.db = db;
  }

  /** Exposed for tools, tests and the HTTP layer that need raw queries. */
  get database() {
    return this.db;
  }

  // ------------------------------------------------------------ accounts

  register({ username, password, displayName }) {
    username = String(username ?? "").trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,24}$/.test(username)) {
      throw badRequest("Username must be 3-24 characters: letters, numbers, _ . -", "bad_username");
    }
    if (String(password ?? "").length < 6) {
      throw badRequest("Password must be at least 6 characters", "bad_password");
    }
    const exists = this.db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    if (exists) throw new AppError(409, "username_taken", "That username is taken");

    const now = Date.now();
    const info = this.db.prepare(`
      INSERT INTO users (username, display_name, password_hash, created_at, hearts_updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(username, displayName ?? username, hashPassword(password), now, now);
    const userId = Number(info.lastInsertRowid);
    this.logEvent(userId, "register", { username });
    return this.publicUser(this.getUser(userId));
  }

  authenticate(username, password) {
    const row = this.db.prepare("SELECT * FROM users WHERE username = ?")
      .get(String(username ?? "").trim().toLowerCase());
    if (!row || !verifyPassword(String(password ?? ""), row.password_hash)) {
      throw new AppError(401, "bad_credentials", "Wrong username or password");
    }
    return row;
  }

  createSession(userId) {
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    this.db.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(tokenHash(token), userId, now, now + 30 * 24 * 3600 * 1000);
    return token;
  }

  destroySession(token) {
    this.db.prepare("DELETE FROM sessions WHERE token = ?").run(tokenHash(token));
  }

  userForToken(token) {
    if (!token) return null;
    const row = this.db.prepare(`
      SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?
    `).get(tokenHash(token), Date.now());
    return row ?? null;
  }

  getUser(id) {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (!row) throw notFound("No such user");
    return this.syncHearts(row);
  }

  /** Applies heart regeneration on read, so the client always sees a truthful number. */
  syncHearts(row, now = Date.now()) {
    const { hearts, heartsUpdatedAt } = regenerateHearts(row, now);
    if (hearts !== row.hearts || heartsUpdatedAt !== row.hearts_updated_at) {
      this.db.prepare("UPDATE users SET hearts = ?, hearts_updated_at = ? WHERE id = ?")
        .run(hearts, heartsUpdatedAt, row.id);
      return { ...row, hearts, hearts_updated_at: heartsUpdatedAt };
    }
    return row;
  }

  publicUser(row) {
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatar: row.avatar,
      xp: row.xp,
      gems: row.gems,
      hearts: row.hearts,
      maxHearts: MAX_HEARTS,
      minutesToNextHeart: minutesToNextHeart(row),
      streak: row.streak,
      longestStreak: row.longest_streak,
      lastPracticeDay: row.last_practice_day,
      dailyGoal: row.daily_goal,
      dailyXp: row.daily_xp_day === dayKey(new Date()) ? row.daily_xp : 0,
      streakFreezes: row.streak_freezes,
      soundEnabled: !!row.sound_enabled,
      speakingEnabled: !!row.speaking_enabled,
      profilePublic: !!row.profile_public,
      leaderboardOptin: !!row.leaderboard_optin,
    };
  }

  updateSettings(userId, patch) {
    const allowed = {
      displayName: "display_name", avatar: "avatar", dailyGoal: "daily_goal",
      soundEnabled: "sound_enabled", speakingEnabled: "speaking_enabled",
      profilePublic: "profile_public", leaderboardOptin: "leaderboard_optin",
    };
    const sets = [];
    const vals = [];
    for (const [k, col] of Object.entries(allowed)) {
      if (patch[k] !== undefined) {
        sets.push(`${col} = ?`);
        vals.push(typeof patch[k] === "boolean" ? (patch[k] ? 1 : 0) : patch[k]);
      }
    }
    if (sets.length) {
      this.db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...vals, userId);
    }
    return this.publicUser(this.getUser(userId));
  }

  // ------------------------------------------------------------ courses

  courses() {
    return courseSummaries();
  }

  enrol(userId, courseId) {
    const course = getCourse(courseId);
    if (!course) throw notFound(`No course ${courseId}`);
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO user_courses (user_id, course_id, learning, started_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(user_id, course_id) DO UPDATE SET learning = 1
    `).run(userId, courseId, now);

    // Seed progress: first skill unlocked, everything else locked.
    course.skills.forEach((skill, i) => {
      this.db.prepare(`
        INSERT INTO skill_progress (user_id, course_id, skill_id, unlocked, level)
        VALUES (?, ?, ?, ?, 0)
        ON CONFLICT(user_id, course_id, skill_id) DO NOTHING
      `).run(userId, courseId, skill.id, i === 0 ? 1 : 0);
    });

    // Seed SRS rows for every item, all due immediately.
    for (const item of allItems(course)) {
      this.db.prepare(`
        INSERT INTO srs_items (user_id, course_id, item_id, skill_id, ease, interval_days, reps, lapses, due_at)
        VALUES (?, ?, ?, ?, 2.5, 0, 0, 0, ?)
        ON CONFLICT(user_id, course_id, item_id) DO NOTHING
      `).run(userId, courseId, item.id, item.skillId, now);
    }
    this.logEvent(userId, "enrol", { courseId });
    return this.courseState(userId, courseId);
  }

  myCourses(userId) {
    // The "learning" course first, then the rest by when they were started. Without the
    // ordering, switching course would appear to do nothing: home() always takes the first.
    const rows = this.db.prepare(
      "SELECT course_id FROM user_courses WHERE user_id = ? ORDER BY learning DESC, started_at ASC"
    ).all(userId);
    return rows.map((r) => this.courseState(userId, r.course_id));
  }

  /** Makes `courseId` the course the user is actively learning. */
  switchCourse(userId, courseId) {
    const course = getCourse(courseId);
    if (!course) throw notFound(`No course ${courseId}`);
    const enrolled = this.db.prepare(
      "SELECT 1 AS x FROM user_courses WHERE user_id = ? AND course_id = ?").get(userId, courseId);
    if (!enrolled) this.enrol(userId, courseId);

    this.db.prepare("UPDATE user_courses SET learning = 0 WHERE user_id = ?").run(userId);
    this.db.prepare("UPDATE user_courses SET learning = 1 WHERE user_id = ? AND course_id = ?")
      .run(userId, courseId);
    this.logEvent(userId, "switch_course", { courseId });
    return this.courseState(userId, courseId);
  }

  /** The full course tree for a user: skills, unlock state, crowns, SRS strength. */
  courseState(userId, courseId) {
    const course = getCourse(courseId);
    if (!course) throw notFound(`No course ${courseId}`);
    const enrolled = this.db.prepare(
      "SELECT * FROM user_courses WHERE user_id = ? AND course_id = ?").get(userId, courseId);

    const progress = new Map(
      this.db.prepare("SELECT * FROM skill_progress WHERE user_id = ? AND course_id = ?")
        .all(userId, courseId).map((r) => [r.skill_id, r]));

    const items = allItems(course);
    const srsRows = this.db.prepare(
      "SELECT * FROM srs_items WHERE user_id = ? AND course_id = ?").all(userId, courseId);
    const srsById = new Map(srsRows.map((r) => [r.item_id, mapSrs(r)]));

    const skills = course.skills.map((skill, index) => {
      const p = progress.get(skill.id);
      const skillItems = items.filter((i) => i.skillId === skill.id);
      const learned = skillItems.filter((i) => (srsById.get(i.id)?.reps ?? 0) > 0).length;
      const dueCount = skillItems.filter((i) => (srsById.get(i.id)?.dueAt ?? 0) <= Date.now()).length;
      const avgStrength = skillItems.length
        ? Math.round(skillItems.reduce((a, i) => a + strength(srsById.get(i.id)), 0) / skillItems.length)
        : 0;
      const level = p?.level ?? 0;
      return {
        id: skill.id,
        title: skill.title,
        icon: skill.icon,
        notes: skill.notes ?? null,
        index,
        level,
        maxLevel: MAX_SKILL_LEVEL,
        crowns: level,
        unlocked: !!p?.unlocked,
        completed: level >= MAX_SKILL_LEVEL,
        itemCount: skillItems.length,
        learned,
        dueCount,
        strength: avgStrength,
        lessonAvailable: !!p?.unlocked && level < MAX_SKILL_LEVEL,
      };
    });

    const known = items.length;
    const learnedTotal = items.filter((i) => (srsById.get(i.id)?.reps ?? 0) > 0).length;

    return {
      id: course.id,
      name: course.name,
      from: course.from,
      to: course.to,
      flag: course.flag,
      color: course.color,
      tts: course.tts,
      enrolled: !!enrolled,
      xp: enrolled?.xp ?? 0,
      crowns: skills.reduce((a, s) => a + s.crowns, 0),
      skills,
      stories: storiesFor(courseId).map((s) => ({
        id: s.id,
        title: s.title,
        titleEn: s.titleEn,
        icon: s.icon,
        lineCount: s.lines.length,
        questionCount: s.questions.length,
        unlocked: skills.filter((s2) => s2.completed).length >= s.requiresSkills,
        requiresSkills: s.requiresSkills,
      })),
      totals: {
        items: known,
        learned: learnedTotal,
        due: [...srsById.values()].filter((s) => s.dueAt <= Date.now()).length,
        wordsLearned: learnedTotal,
      },
    };
  }

  // ------------------------------------------------------------ lessons

  /**
   * Starts a lesson, practice session or story.
   *
   * kind: 'lesson'    — next level of an unlocked skill (costs hearts on mistakes)
   *       'practice'  — free practice on a skill you have already touched (no hearts)
   *       'review'    — spaced-repetition queue across the course (no hearts)
   *       'story'     — a dialogue with comprehension questions
   */
  startSession(userId, { courseId, skillId, kind = "lesson", storyId = null, clientDay = null }) {
    const course = getCourse(courseId);
    if (!course) throw notFound(`No course ${courseId}`);
    const user = this.getUser(userId);
    const today = clientDay || dayKey(new Date());

    if (!["lesson", "practice", "review", "story"].includes(kind)) {
      throw badRequest(`Unknown session kind: ${kind}`);
    }

    if (kind !== "practice" && kind !== "review" && kind !== "story" && user.hearts <= 0) {
      throw new AppError(409, "no_hearts",
        `You are out of hearts. Refill for ${HEART_REFILL_GEMS} gems, or do practice which is free.`,
        { hearts: 0, refillCost: HEART_REFILL_GEMS, minutesToNextHeart: minutesToNextHeart(user) });
    }

    let exercises = [];
    let items = [];

    if (kind === "story") {
      const stories = storiesFor(courseId);
      const story = stories.find((s) => s.id === storyId) ?? stories[0];
      if (!story) throw notFound("This course has no stories yet");
      const srsById = new Map(
        this.db.prepare("SELECT * FROM srs_items WHERE user_id = ? AND course_id = ?")
          .all(userId, courseId).map((r) => [r.item_id, mapSrs(r)]));
      const maxDue = Math.max(0, ...[...srsById.values()].map((s) => s.dueAt));
      exercises = [{
        id: `${story.id}:story:1`,
        type: "story",
        itemId: story.id,
        skillId: story.id,
        order: 0,
        directions: "Read the conversation, then answer the questions",
        title: story.title,
        titleEn: story.titleEn,
        lines: story.lines,
        questions: story.questions,
        answer: null,
      }];
      items = [{ itemId: story.id, skillId: story.id, srs: { dueAt: maxDue } }];
    } else if (kind === "review") {
      const rows = this.db.prepare(
        "SELECT * FROM srs_items WHERE user_id = ? AND course_id = ?").all(userId, courseId);
      const pool = rows.map((r) => ({
        ...itemById(courseId, r.item_id),
        itemId: r.item_id,
        skillId: r.skill_id,
        srs: mapSrs(r),
      })).filter((i) => i.id);
      const queue = buildReviewQueue(pool, { limit: LESSON_SIZE });
      if (queue.length === 0) {
        throw new AppError(409, "nothing_due", "Nothing is due for review right now. Try a lesson!");
      }
      items = queue;
      exercises = buildExercisesFor(queue, course, { speaking: true });
    } else {
      const skill = getSkill(courseId, skillId);
      if (!skill) throw notFound(`No skill ${skillId} in ${courseId}`);

      const prog = this.db.prepare(
        "SELECT * FROM skill_progress WHERE user_id = ? AND course_id = ? AND skill_id = ?")
        .get(userId, courseId, skillId);
      if (!prog) throw badRequest("You are not enrolled in this course", "not_enrolled");
      if (kind === "lesson" && !prog.unlocked) {
        throw new AppError(409, "skill_locked", "Finish the previous skill first");
      }

      const skillItems = skill.items.map((i) => ({ ...i, skillId: skill.id }));
      // For a lesson, front-load items the learner has not mastered yet.
      const srsById = new Map(
        this.db.prepare("SELECT * FROM srs_items WHERE user_id = ? AND course_id = ? AND skill_id = ?")
          .all(userId, courseId, skillId).map((r) => [r.item_id, mapSrs(r)]));

      const ordered = kind === "practice"
        ? [...skillItems].sort((a, b) =>
            (srsById.get(a.id)?.dueAt ?? 0) - (srsById.get(b.id)?.dueAt ?? 0))
        : [...skillItems].sort((a, b) => {
            const ra = srsById.get(a.id)?.reps ?? 0;
            const rb = srsById.get(b.id)?.reps ?? 0;
            return ra - rb;   // least-practised first
          });

      items = ordered.map((i) => ({ ...i, itemId: i.id, srs: srsById.get(i.id) ?? freshItem() }));
      exercises = buildExercisesFor(items, course, {
        // Speaking is available in every course now. The user's setting controls whether it is
        // *graded strictly* rather than whether it appears at all — a learner who turns speaking
        // "off" still gets the exercise but can skip it with the type-in fallback.
        speaking: true,
      });
      if (exercises.length === 0) throw badRequest("This skill has no exercises yet");
    }

    const id = randomUUID();
    const state = {
      exerciseIndex: 0,
      exercises,
      heartsStart: user.hearts,
      mistakes: [],
      correct: 0,
      answered: 0,
      combo: 0,
      comboMax: 0,
      seen: [],
      startedAt: Date.now(),
      clientDay: today,
    };
    this.db.prepare(`
      INSERT INTO lesson_sessions (id, user_id, course_id, skill_id, kind, state, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, courseId, skillId ?? null, kind, JSON.stringify(state), Date.now());

    return {
      sessionId: id,
      kind,
      courseId,
      skillId,
      hearts: user.hearts,
      total: exercises.length,
      exercise: publicExercise(exercises[0]),
      index: 0,
      progress: 0,
    };
  }

  /** Grades one answer, advances the queue, and returns the next exercise. */
  answer(userId, sessionId, { exerciseId, answer, ms = 0, clientDay = null }) {
    const session = this.db.prepare(
      "SELECT * FROM lesson_sessions WHERE id = ? AND user_id = ?").get(sessionId, userId);
    if (!session) throw notFound("No such session");
    if (session.finished_at) throw badRequest("This session is already finished", "session_done");

    const state = JSON.parse(session.state);
    const exercise = state.exercises[state.exerciseIndex];
    if (!exercise) throw badRequest("No exercise is pending", "no_exercise");
    if (exerciseId && exerciseId !== exercise.id) {
      // A double-click or a retried request can arrive for an exercise that was already
      // graded. Treating that as an error wedges the UI permanently, so instead we re-send
      // the current exercise and let the client resynchronise.
      const alreadyAnswered = (state.answeredIds ?? []).includes(exerciseId);
      if (alreadyAnswered) {
        const pending = state.exercises[state.exerciseIndex];
        return {
          resync: true,
          result: null,
          hearts: this.getUser(userId).hearts,
          combo: state.combo,
          comboMax: state.comboMax,
          correct: state.correct,
          answered: state.answered,
          answeredIds: state.answeredIds ?? [],
          finished: false,
          next: publicExercise(pending),
          index: state.exerciseIndex,
          total: state.exercises.length,
          progress: state.exerciseIndex / state.exercises.length,
        };
      }
      throw new AppError(409, "out_of_sync",
        "That answer was for a different exercise; reload the session", {
          expected: exercise.id, got: exerciseId,
        });
    }

    const course = getCourse(session.course_id);
    const item = itemById(session.course_id, exercise.itemId);
    const result = gradeAnswer(exercise, answer, { lang: course?.tts?.slice(0, 2) });

    // If the learner used a hint that gave the answer away, count it as correct but do not let
    // it earn a clean-accuracy credit or extend the combo — otherwise the combo and the
    // "perfect lesson" achievement become meaningless.
    const hinted = (state.hinted ?? []).some((h) => h.exerciseId === exercise.id && h.reveals);
    if (hinted && result.correct) {
      result.hinted = true;
      result.feedback = `${result.feedback ?? "Correct!"} (you used a hint)`;
    }

    // ---- session bookkeeping
    state.answered += 1;
    if (result.correct) {
      state.correct += 1;
      if (hinted) {
        // A hinted answer breaks the combo: the streak of unaided answers is what it rewards.
        state.combo = 0;
      } else {
        state.combo += 1;
        state.comboMax = Math.max(state.comboMax, state.combo);
      }
    } else {
      state.combo = 0;
      state.mistakes.push({ exerciseId: exercise.id, itemId: exercise.itemId, type: exercise.type });
      // A failed exercise is re-served once, at the end of the session. Stories are one-shot
      // comprehension checks, and a retry is never re-queued again — otherwise failing a
      // retry would append another retry forever and the session could never end.
      if (exercise.type !== "story" && exercise.type !== "review_mistake") {
        const again = {
          ...exercise,
          id: `${exercise.id}:retry`,
          type: "review_mistake",
          originalType: exercise.type,
          original: exercise,
          order: state.exercises.length,
          isRetry: true,
        };
        if (!state.exercises.some((e) => e.id === again.id)) state.exercises.push(again);
      }
    }

    if (!state.seen.includes(exercise.itemId)) state.seen.push(exercise.itemId);

    // ---- hearts
    const lost = result.correct ? 0 : heartsForMistake(session.kind);
    const user = this.getUser(userId);
    let hearts = user.hearts;
    if (lost > 0 && hearts > 0) {
      hearts -= lost;
      this.db.prepare("UPDATE users SET hearts = ?, hearts_updated_at = ? WHERE id = ?")
        .run(hearts, Date.now(), userId);
    }

    // ---- SRS: update the scheduling state for this item
    if (item) {
      this.updateSrs(userId, session.course_id, exercise.itemId, exercise.skillId ?? item.skillId, result.grade);
    }

    this.db.prepare(`
      INSERT INTO lesson_answers (session_id, item_id, exercise, correct, user_answer, ms, at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sessionId, exercise.itemId, exercise.type, result.correct ? 1 : 0,
           JSON.stringify(answer ?? null), ms, Date.now());

    state.exerciseIndex += 1;
    // Remember what has been graded so a duplicate/retried request can be recognised.
    state.answeredIds = [...(state.answeredIds ?? []), exercise.id];

    // ---- out of hearts ends the session early, like Duolingo
    const outOfHearts = hearts <= 0 && session.kind !== "practice" && session.kind !== "review";

    this.db.prepare("UPDATE lesson_sessions SET state = ? WHERE id = ?")
      .run(JSON.stringify(state), sessionId);

    const finished = outOfHearts || state.exerciseIndex >= state.exercises.length;

    const payload = {
      result: {
        correct: result.correct,
        feedback: result.feedback ?? (result.correct ? "Correct!" : "Not quite."),
        expected: result.expected ?? null,
        heard: result.heard ?? null,
        grade: result.grade,
        // The client needs to know *why* an answer was accepted or rejected: `mistake` drives the
        // "close enough" wording, and `diff` drives the word-by-word breakdown on a failure.
        mistake: result.mistake ?? null,
        diff: result.diff ?? null,
        hinted: result.hinted ?? false,
      },
      hearts,
      combo: state.combo,
      comboMax: state.comboMax,
      comboMultiplier: comboTier(state.combo),
      correct: state.correct,
      answered: state.answered,
      answeredIds: [exercise.id],
      finished,
    };

    if (!finished) {
      const next = state.exercises[state.exerciseIndex];
      payload.next = publicExercise(next);
      payload.index = state.exerciseIndex;
      payload.total = state.exercises.length;
      payload.progress = state.exerciseIndex / state.exercises.length;
      return payload;
    }

    payload.summary = this.finishSession(userId, session, state, {
      outOfHearts, clientDay: clientDay || state.clientDay || dayKey(new Date()),
    });
    return payload;
  }

  /**
   * Serves one rung of an exercise's hint ladder.
   *
   * Hints are server-side on purpose: the answer never reaches the client until the learner
   * explicitly asks for the rung that reveals it. Using a revealing hint marks the attempt as
   * hinted so it cannot be scored as a clean correct answer.
   */
  hint(userId, sessionId, { exerciseId, step }) {
    const session = this.db.prepare(
      "SELECT * FROM lesson_sessions WHERE id = ? AND user_id = ?").get(sessionId, userId);
    if (!session) throw notFound("No such session");
    if (session.finished_at) throw badRequest("This session is already finished", "session_done");

    const state = JSON.parse(session.state);
    const exercise = state.exercises[state.exerciseIndex];
    if (!exercise) throw badRequest("No exercise is pending", "no_exercise");
    if (exerciseId && exerciseId !== exercise.id) {
      throw new AppError(409, "out_of_sync", "That hint was for a different exercise", {
        expected: exercise.id,
      });
    }

    const available = hintPreview(exercise);
    if (available.length === 0) {
      return { exerciseId: exercise.id, hints: [], hint: null, supported: false };
    }

    // A preview request (no step) just tells the client what rungs exist.
    if (step === undefined || step === null) {
      return { exerciseId: exercise.id, hints: available, hint: null, supported: true };
    }

    const found = hintStep(exercise, step);
    if (!found) throw badRequest(`No hint step ${step} for this exercise`, "no_such_hint");

    // Remember that help was used on this exercise.
    state.hinted = state.hinted ?? [];
    if (found.reveals && !state.hinted.some((h) => h.exerciseId === exercise.id && h.reveals)) {
      state.hinted.push({ exerciseId: exercise.id, reveals: true, step: found.step });
    }
    state.hintsUsed = state.hintsUsed ?? {};
    state.hintsUsed[exercise.id] = Math.max(state.hintsUsed[exercise.id] ?? 0, found.step);
    this.db.prepare("UPDATE lesson_sessions SET state = ? WHERE id = ?")
      .run(JSON.stringify(state), sessionId);

    return {
      exerciseId: exercise.id,
      hint: { ...found, text: found.text },
      hints: available,
      supported: true,
      // True once the learner has seen the answer, so the client can warn / the server can score.
      spent: found.reveals === true,
    };
  }

  /** Which exercise the client should be showing right now. Used to recover from a desync. */
  currentExercise(userId, sessionId) {
    const session = this.db.prepare(
      "SELECT * FROM lesson_sessions WHERE id = ? AND user_id = ?").get(sessionId, userId);
    if (!session) throw notFound("No such session");
    const state = JSON.parse(session.state);
    if (session.finished_at) {
      return {
        finished: true,
        summary: session.summary ? JSON.parse(session.summary) : null,
        exercise: null, index: state.exercises.length, total: state.exercises.length,
        hearts: this.getUser(userId).hearts,
      };
    }
    const exercise = state.exercises[state.exerciseIndex];
    return {
      finished: false,
      exercise: publicExercise(exercise),
      index: state.exerciseIndex,
      total: state.exercises.length,
      hearts: this.getUser(userId).hearts,
      progress: state.exerciseIndex / state.exercises.length,
    };
  }

  /** Wraps up a session: XP, streak, daily goal, quests, achievements, skill level-up. */
  finishSession(userId, session, state, { outOfHearts = false, clientDay } = {}) {
    const row = this.getUser(userId);
    const today = clientDay || state.clientDay || dayKey(new Date());
    const courseId = session.course_id;
    const course = getCourse(courseId);

    // Gamification works on a camelCase user view; the DB row is snake_case. Converting in
    // one place here prevents the whole class of "streak never advanced" style bugs.
    const user = {
      ...row,
      displayName: row.display_name,
      lastPracticeDay: row.last_practice_day,
      longestStreak: row.longest_streak,
      streakFreezes: row.streak_freezes,
      freezeUsedDay: row.freeze_used_day,
      dailyXp: row.daily_xp,
      dailyXpDay: row.daily_xp_day,
      dailyGoal: row.daily_goal,
    };

    const total = state.exercises.length;
    const correct = state.correct;
    const accuracy = state.answered > 0 ? correct / state.answered : 0;
    // Passing threshold: Duolingo ends a lesson when you clear the queue; a run that ran out
    // of hearts counts as failed even if most answers were right.
    const passed = !outOfHearts && state.mistakes.length <= Math.floor(total * 0.4);

    const xp = passed ? lessonXp({
      kind: session.kind,
      correct,
      total: state.answered,
      comboMax: state.comboMax,
    }) : 0;

    let updated = { ...user };

    if (xp > 0) {
      updated.xp = (user.xp ?? 0) + xp;
      const daily = addDailyXp(user, xp, today);
      updated.dailyXp = daily.dailyXp;
      updated.dailyXpDay = daily.dailyXpDay;

      const streak = advanceStreak(user, today);
      updated.streak = streak.streak;
      updated.longestStreak = streak.longestStreak;
      updated.lastPracticeDay = streak.lastPracticeDay;
      updated.streakFreezes = streak.streakFreezes;
      updated.freezeUsedDay = streak.freezeUsedDay;

      this.db.prepare(`
        UPDATE users SET xp = ?, daily_xp = ?, daily_xp_day = ?, streak = ?, longest_streak = ?,
                         last_practice_day = ?, streak_freezes = ?, freeze_used_day = ?
        WHERE id = ?
      `).run(updated.xp, updated.dailyXp, updated.dailyXpDay, updated.streak, updated.longestStreak,
             updated.lastPracticeDay ?? null, updated.streakFreezes ?? 0, updated.freezeUsedDay ?? null, userId);

      // Course XP + weekly leaderboard XP.
      this.db.prepare(`
        INSERT INTO user_courses (user_id, course_id, learning, xp, started_at)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(user_id, course_id) DO UPDATE SET xp = xp + ?
      `).run(userId, courseId, xp, Date.now(), xp);

      this.db.prepare(`
        INSERT INTO leaderboard (user_id, week, xp, league) VALUES (?, ?, ?, 'bronze')
        ON CONFLICT(user_id, week) DO UPDATE SET xp = xp + ?
      `).run(userId, weekKey(new Date()), xp, xp);

      this.bumpQuests(userId, today, { xp, lessons: 1, perfect: state.mistakes.length === 0 ? 1 : 0,
                                       combo: state.comboMax, review: session.kind === "review" ? state.seen.length : 0,
                                       newWords: state.seen.filter((id) => {
                                         const row = this.db.prepare(
                                           "SELECT reps FROM srs_items WHERE user_id=? AND course_id=? AND item_id=?")
                                           .get(userId, courseId, id);
                                         return (row?.reps ?? 1) <= 1;
                                       }).length });
    }

    // ---- skill level up
    let skillUp = null;
    if (passed && session.kind === "lesson" && session.skill_id) {
      skillUp = this.levelUpSkill(userId, courseId, session.skill_id);
    }

    // The session must be recorded as finished BEFORE achievements are evaluated, or
    // "complete your first lesson" can never unlock on that very lesson.
    this.db.prepare("UPDATE lesson_sessions SET finished_at = ?, passed = ?, xp_awarded = ?, state = ? WHERE id = ?")
      .run(Date.now(), passed ? 1 : 0, xp, JSON.stringify(state), session.id);

    // ---- achievements
    const totals = {
      lessonsCompleted: passed ? 1 : 0,
      streak: updated.streak ?? 0,
      xp: updated.xp ?? 0,
      crowns: this.countCrowns(userId, courseId),
      perfectLessons: this.countPerfect(userId),
      bestCombo: state.comboMax,
      wordsLearned: this.countLearned(userId, courseId),
    };
    const earned = earnedAchievements(totals);
    const fresh = [];
    for (const id of earned) {
      const already = this.db.prepare(
        "SELECT 1 FROM achievements WHERE user_id = ? AND achievement = ?").get(userId, id);
      if (!already) {
        this.db.prepare("INSERT INTO achievements (user_id, achievement, unlocked_at) VALUES (?, ?, ?)")
          .run(userId, id, Date.now());
        fresh.push(ACHIEVEMENTS.find((a) => a.id === id));
      }
    }

    this.logEvent(userId, "lesson_finished", {
      courseId, skillId: session.skill_id, kind: session.kind,
      passed, xp, accuracy: Math.round(accuracy * 100),
    });

    const refreshed = this.getUser(userId);
    const summary = {
      passed,
      outOfHearts,
      xp,
      correct,
      answered: state.answered,
      mistakes: state.mistakes.length,
      accuracy: Math.round(accuracy * 100),
      comboMax: state.comboMax,
      streak: refreshed.streak,
      streakIncreased: refreshed.streak > (user.streak ?? 0),
      dailyXp: refreshed.daily_xp_day === today ? refreshed.daily_xp : 0,
      dailyGoal: refreshed.daily_goal,
      dailyGoalMet: dailyGoalMet({ ...refreshed, dailyXpDay: refreshed.daily_xp_day,
                                   dailyXp: refreshed.daily_xp, dailyGoal: refreshed.daily_goal }, today),
      hearts: refreshed.hearts,
      gems: refreshed.gems,
      skillUp,
      achievements: fresh.filter(Boolean),
      totalXp: refreshed.xp,
    };

    // Stored so the results can be re-read if the client loses the response.
    this.db.prepare("UPDATE lesson_sessions SET summary = ? WHERE id = ?")
      .run(JSON.stringify(summary), session.id);

    return summary;
  }

  /** Advances a skill's level, and unlocks the next skill when this one is mastered. */
  levelUpSkill(userId, courseId, skillId) {
    const course = getCourse(courseId);
    const progress = this.db.prepare(
      "SELECT * FROM skill_progress WHERE user_id = ? AND course_id = ? AND skill_id = ?")
      .get(userId, courseId, skillId);
    if (!progress) return null;

    const newLevel = Math.min(MAX_SKILL_LEVEL, (progress.level ?? 0) + 1);
    const completedAt = newLevel >= MAX_SKILL_LEVEL ? Date.now() : null;
    this.db.prepare(`
      UPDATE skill_progress SET level = ?, crowns = ?, completed_at = ? 
      WHERE user_id = ? AND course_id = ? AND skill_id = ?
    `).run(newLevel, newLevel, completedAt, userId, courseId, skillId);

    let unlocked = null;
    if (newLevel >= MAX_SKILL_LEVEL) {
      const idx = course.skills.findIndex((s) => s.id === skillId);
      const next = course.skills[idx + 1];
      if (next) {
        this.db.prepare(`
          UPDATE skill_progress SET unlocked = 1
          WHERE user_id = ? AND course_id = ? AND skill_id = ?
        `).run(userId, courseId, next.id);
        unlocked = { id: next.id, title: next.title };
      }
    }
    return { skillId, level: newLevel, maxLevel: MAX_SKILL_LEVEL, completed: newLevel >= MAX_SKILL_LEVEL, unlocked };
  }

  updateSrs(userId, courseId, itemId, skillId, gradeValue, now = Date.now()) {
    const row = this.db.prepare(
      "SELECT * FROM srs_items WHERE user_id = ? AND course_id = ? AND item_id = ?")
      .get(userId, courseId, itemId);
    const current = row ? mapSrs(row) : freshItem(now);
    const next = schedule(current, gradeValue, now);
    this.db.prepare(`
      INSERT INTO srs_items (user_id, course_id, item_id, skill_id, ease, interval_days, reps, lapses, due_at, last_seen, last_grade)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, course_id, item_id) DO UPDATE SET
        ease = ?, interval_days = ?, reps = ?, lapses = ?, due_at = ?, last_seen = ?, last_grade = ?
    `).run(userId, courseId, itemId, skillId ?? row?.skill_id ?? "unknown",
           next.ease, next.intervalDays, next.reps, next.lapses, next.dueAt, next.lastSeen, next.lastGrade,
           next.ease, next.intervalDays, next.reps, next.lapses, next.dueAt, next.lastSeen, next.lastGrade);
    return next;
  }

  // ------------------------------------------------------------ economy

  refillHearts(userId) {
    const user = this.getUser(userId);
    if (user.hearts >= MAX_HEARTS) throw badRequest("Your hearts are already full", "hearts_full");
    if (user.gems < HEART_REFILL_GEMS) {
      throw new AppError(409, "not_enough_gems", `You need ${HEART_REFILL_GEMS} gems`, { gems: user.gems });
    }
    this.db.prepare("UPDATE users SET hearts = ?, gems = gems - ?, hearts_updated_at = ? WHERE id = ?")
      .run(MAX_HEARTS, HEART_REFILL_GEMS, Date.now(), userId);
    this.logEvent(userId, "hearts_refilled", { cost: HEART_REFILL_GEMS });
    return this.publicUser(this.getUser(userId));
  }

  buyStreakFreeze(userId) {
    const user = this.getUser(userId);
    if (user.gems < STREAK_FREEZE_GEMS) {
      throw new AppError(409, "not_enough_gems", `You need ${STREAK_FREEZE_GEMS} gems`, { gems: user.gems });
    }
    this.db.prepare("UPDATE users SET streak_freezes = streak_freezes + 1, gems = gems - ? WHERE id = ?")
      .run(STREAK_FREEZE_GEMS, userId);
    return this.publicUser(this.getUser(userId));
  }

  /** Practice is free; this is the "earn gems back" path, like Duolingo's chests. */
  awardGems(userId, amount, reason = "reward") {
    this.db.prepare("UPDATE users SET gems = gems + ? WHERE id = ?").run(amount, userId);
    this.logEvent(userId, "gems_awarded", { amount, reason });
    return this.publicUser(this.getUser(userId));
  }

  // ------------------------------------------------------------ quests etc.

  quests(userId, today = dayKey(new Date())) {
    const defs = dailyQuests(today);
    const rows = this.db.prepare("SELECT * FROM quests WHERE user_id = ? AND day = ?").all(userId, today);
    const byId = new Map(rows.map((r) => [r.quest_id, r]));
    for (const d of defs) {
      if (!byId.has(d.id)) {
        this.db.prepare("INSERT INTO quests (user_id, day, quest_id, progress, goal) VALUES (?, ?, ?, 0, ?)")
          .run(userId, today, d.id, d.goal);
        byId.set(d.id, { quest_id: d.id, progress: 0, goal: d.goal, claimed: 0 });
      }
    }
    return defs.map((d) => {
      const r = byId.get(d.id);
      return {
        id: d.id, label: d.label, kind: d.kind,
        progress: Math.min(r.progress, d.goal), goal: d.goal,
        done: r.progress >= d.goal, claimed: !!r.claimed,
      };
    });
  }

  bumpQuests(userId, today, deltas) {
    const map = {
      earn_xp: deltas.xp ?? 0,
      complete_lessons: deltas.lessons ?? 0,
      perfect_lessons: deltas.perfect ?? 0,
      score_combo: deltas.combo ?? 0,
      review_items: deltas.review ?? 0,
      learn_new: deltas.newWords ?? 0,
      speak_practice: deltas.speak ?? 0,
      listen_practice: deltas.listen ?? 0,
    };
    const defs = dailyQuests(today);
    for (const d of defs) {
      const amount = map[d.id] ?? 0;
      if (!amount) continue;
      this.db.prepare(`
        INSERT INTO quests (user_id, day, quest_id, progress, goal) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, day, quest_id) DO UPDATE SET
          progress = CASE
            WHEN ? = 'score_combo' THEN MAX(progress, ?)
            ELSE MIN(goal, progress + ?)
          END
      `).run(userId, today, d.id, Math.min(amount, d.goal), d.goal, d.id, amount, amount);
    }
  }

  claimQuest(userId, questId, today = dayKey(new Date())) {
    const defs = dailyQuests(today);
    const def = defs.find((d) => d.id === questId);
    if (!def) throw notFound("That quest is not active today");
    const row = this.db.prepare(
      "SELECT * FROM quests WHERE user_id = ? AND day = ? AND quest_id = ?").get(userId, today, questId);
    if (!row || row.progress < def.goal) throw badRequest("That quest is not finished yet", "quest_incomplete");
    if (row.claimed) throw badRequest("Already claimed", "already_claimed");
    this.db.prepare("UPDATE quests SET claimed = 1 WHERE user_id = ? AND day = ? AND quest_id = ?")
      .run(userId, today, questId);
    const reward = 20;
    this.awardGems(userId, reward, `quest:${questId}`);
    return { questId, gems: reward, user: this.publicUser(this.getUser(userId)) };
  }

  achievements(userId) {
    const rows = this.db.prepare("SELECT * FROM achievements WHERE user_id = ?").all(userId);
    const byId = new Map(rows.map((r) => [r.achievement, r]));
    return ACHIEVEMENTS.map((a) => ({
      ...a,
      unlocked: byId.has(a.id),
      unlockedAt: byId.get(a.id)?.unlocked_at ?? null,
    }));
  }

  leaderboard(userId, week = weekKey(new Date())) {
    const user = this.getUser(userId);
    const rows = this.db.prepare(`
      SELECT l.user_id, l.xp, l.league, u.username, u.display_name, u.avatar
      FROM leaderboard l JOIN users u ON u.id = l.user_id
      WHERE l.week = ? AND u.leaderboard_optin = 1
      ORDER BY l.xp DESC, l.user_id ASC
      LIMIT 50
    `).all(week);

    // If the user has no row yet, they still see themselves at zero.
    const has = rows.some((r) => r.user_id === userId);
    const entries = rows.map((r, i) => ({
      rank: i + 1,
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name,
      avatar: r.avatar,
      xp: r.xp,
      league: r.league,
      isYou: r.user_id === userId,
    }));
    if (!has) {
      entries.push({
        rank: entries.length + 1, userId, username: user.username, displayName: user.display_name,
        avatar: user.avatar, xp: 0, league: "bronze", isYou: true,
      });
    }
    const mine = entries.find((e) => e.isYou);
    return {
      week,
      entries,
      you: mine ?? null,
      outcome: mine ? leagueOutcome(mine.rank, entries.length) : "stay",
    };
  }

  /** The home screen: everything a client needs in one call. */
  home(userId, clientDay = null) {
    const user = this.getUser(userId);
    const today = clientDay || dayKey(new Date());
    const courses = this.myCourses(userId);
    const current = courses[0] ?? null;
    let nextSkill = null;
    if (current) {
      nextSkill = current.skills.find((s) => s.lessonAvailable) ?? null;
    }
    const due = current
      ? this.db.prepare(
          "SELECT COUNT(*) AS n FROM srs_items WHERE user_id = ? AND course_id = ? AND due_at <= ?")
          .get(userId, current.id, Date.now()).n
      : 0;
    return {
      user: this.publicUser(user),
      courses,
      currentCourse: current,
      nextSkill,
      dueCount: due,
      quests: this.quests(userId, today),
      dailyGoalMet: (user.daily_xp_day === today ? user.daily_xp : 0) >= user.daily_goal,
      streakTier: streakTierSafe(user.streak),
    };
  }

  // ------------------------------------------------------------ helpers

  logEvent(userId, kind, data) {
    this.db.prepare("INSERT INTO events (user_id, kind, data, at) VALUES (?, ?, ?, ?)")
      .run(userId, kind, JSON.stringify(data ?? {}), Date.now());
  }

  countCompleted() {
    return this.db.prepare("SELECT COUNT(*) AS n FROM lesson_sessions WHERE passed = 1").get().n;
  }
  countCrowns(userId, courseId) {
    return this.db.prepare(
      "SELECT COALESCE(SUM(crowns),0) AS n FROM skill_progress WHERE user_id = ? AND course_id = ?")
      .get(userId, courseId).n;
  }
  countPerfect(userId) {
    return this.db.prepare(`
      SELECT COUNT(*) AS n FROM lesson_sessions s
      WHERE s.user_id = ? AND s.passed = 1
        AND NOT EXISTS (SELECT 1 FROM lesson_answers a WHERE a.session_id = s.id AND a.correct = 0)
    `).get(userId).n;
  }
  countLearned(userId, courseId) {
    return this.db.prepare(
      "SELECT COUNT(*) AS n FROM srs_items WHERE user_id = ? AND course_id = ? AND reps > 0")
      .get(userId, courseId).n;
  }

  /** Resets a user's progress for a course — used by tools and tests. */
  resetCourse(userId, courseId) {
    this.db.prepare("DELETE FROM skill_progress WHERE user_id = ? AND course_id = ?").run(userId, courseId);
    this.db.prepare("DELETE FROM srs_items WHERE user_id = ? AND course_id = ?").run(userId, courseId);
    return this.enrol(userId, courseId);
  }
}

// ---------------------------------------------------------------------- helpers

function mapSrs(row) {
  return {
    ease: row.ease,
    intervalDays: row.interval_days,
    reps: row.reps,
    lapses: row.lapses,
    dueAt: row.due_at,
    lastSeen: row.last_seen,
    lastGrade: row.last_grade,
  };
}

function streakTierSafe(streak) {
  const s = streak ?? 0;
  if (s >= 365) return "legendary";
  if (s >= 100) return "obsidian";
  if (s >= 30) return "diamond";
  if (s >= 14) return "gold";
  if (s >= 7) return "silver";
  if (s >= 3) return "bronze";
  return "starter";
}

function itemById(courseId, itemId) {
  const course = getCourse(courseId);
  if (!course) return null;
  const stripped = String(itemId).replace(/:.*$/, "");
  for (const skill of course.skills) {
    const found = skill.items.find((i) => i.id === stripped || i.id === itemId);
    if (found) return { ...found, skillId: skill.id };
  }
  return null;
}

function buildExercisesFor(items, course, { speaking = true } = {}) {
  const siblings = allItems(course);
  const pool = items.length ? items : siblings;
  return buildLesson(pool, {
    size: LESSON_SIZE,
    seed: Date.now() % 100000,
    speaking,
    tts: course.tts,
    toName: course.to,
    siblings,       // distractors come from the whole course, so wrong answers are plausible
  });
}

/** Strips answers out of an exercise before it goes to the client. */
export function publicExercise(ex) {
  if (!ex) return null;
  const out = { ...ex };
  delete out.accepted;
  delete out.original;
  delete out.fullAnswer;
  delete out.blankIndex;

  // A retry ("review_mistake") is graded by the server against its wrapped exercise, but the
  // client has no view for that wrapper type. Present it as the exercise it really is, with a
  // flag so the UI can label it as a second attempt.
  if (out.type === "review_mistake") {
    const inner = out.original ?? ex;
    out.type = out.originalType ?? inner.type ?? "translate";
    out.isRetry = true;
  }

  if (out.type === "select_image") {
    // The `correct` flag is how the server grades this type, but leaving it on the wire
    // hands the answer to anyone who opens devtools. The emoji itself is the answer, so the
    // client never needs to know which one is right.
    out.choices = out.choices.map(({ correct, ...c }) => c);
    delete out.answer;
  } else if (out.type === "story") {
    out.questions = out.questions.map(({ answer, ...q }) => q);
    out.answer = null;
  } else {
    delete out.answer;
  }
  return out;
}

export { MAX_HEARTS, LESSON_SIZE, hashPassword, verifyPassword };
