/**
 * Parroto — spaced repetition scheduler.
 *
 * A compact SM-2 variant. Each content item carries scheduling state per user:
 * an ease factor, an interval, a repetition count and a due date. Grades come from
 * `grade()` in exercises.mjs as 0..3 (again / hard / good / easy).
 *
 * The point of having it here, dependency-free, is that "when should this be shown again?"
 * is the single most testable part of a learning app — so it is pure and unit-tested.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Default state for an item that has never been seen. */
export function freshItem(now = Date.now()) {
  return {
    ease: 2.5,
    intervalDays: 0,
    reps: 0,
    lapses: 0,
    dueAt: now,
    lastSeen: null,
    lastGrade: null,
  };
}

/**
 * Applies one graded answer and returns the next scheduling state.
 *
 * `grade`: 0 again, 1 hard, 2 good, 3 easy.
 * A failure drops the interval back to a short relearn step but keeps most of the ease,
 * so a single slip does not erase long-term progress.
 */
export function schedule(state, grade, now = Date.now()) {
  const prev = state ?? freshItem(now);
  let { ease, intervalDays, reps, lapses } = prev;

  ease = clamp(ease ?? 2.5, 1.3, 3.2);
  intervalDays = intervalDays ?? 0;
  reps = reps ?? 0;
  lapses = lapses ?? 0;

  if (grade <= 0) {
    // Forgotten: relearn soon, one lapse recorded, ease takes a small hit.
    lapses += 1;
    reps = 0;
    ease = clamp(ease - 0.2, 1.3, 3.2);
    intervalDays = 0; // due again within the same session
    return {
      ease,
      intervalDays,
      reps,
      lapses,
      dueAt: now + 10 * 60 * 1000, // ten minutes: back in this session's queue
      lastSeen: now,
      lastGrade: grade,
    };
  }

  // Passing grades stretch the interval. Hard grows slowly, easy jumps ahead.
  const easeDelta = grade === 1 ? -0.15 : grade === 3 ? 0.1 : 0;
  ease = clamp(ease + easeDelta, 1.3, 3.2);

  reps += 1;
  if (reps === 1) {
    intervalDays = grade === 1 ? 0.5 : grade === 2 ? 1 : 2;
  } else if (reps === 2) {
    intervalDays = grade === 1 ? 2 : grade === 2 ? 4 : 6;
  } else {
    const multiplier = grade === 1 ? 1.2 : grade === 2 ? ease : ease * 1.3;
    intervalDays = Math.max(1, intervalDays * multiplier);
  }

  intervalDays = Math.min(intervalDays, 365);

  return {
    ease,
    intervalDays,
    reps,
    lapses,
    dueAt: now + Math.round(intervalDays * DAY_MS),
    lastSeen: now,
    lastGrade: grade,
  };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Is this item due for review? */
export function isDue(state, now = Date.now()) {
  if (!state) return true;
  return (state.dueAt ?? 0) <= now;
}

/** Human-readable strength of an item, for the progress UI. */
export function strength(state) {
  if (!state || !state.reps) return 0;
  const capped = Math.min(state.intervalDays ?? 0, 60);
  return Math.round((capped / 60) * 100);
}

/**
 * Builds a practice queue from due items, mixing skills so a session is not all one topic.
 * `limit` caps the session length; items are ordered by how overdue they are.
 */
export function buildReviewQueue(items, { now = Date.now(), limit = 20 } = {}) {
  const due = items
    .filter((it) => isDue(it.srs, now))
    .sort((a, b) => (a.srs?.dueAt ?? 0) - (b.srs?.dueAt ?? 0));

  if (due.length <= limit) return due;

  // Round-robin across skills so a long backlog stays varied.
  const bySkill = new Map();
  for (const it of due) {
    if (!bySkill.has(it.skillId)) bySkill.set(it.skillId, []);
    bySkill.get(it.skillId).push(it);
  }
  const buckets = [...bySkill.values()];
  const out = [];
  let i = 0;
  while (out.length < limit && buckets.some((b) => b.length)) {
    const b = buckets[i % buckets.length];
    if (b.length) out.push(b.shift());
    i++;
  }
  return out;
}

export const DAY = DAY_MS;
