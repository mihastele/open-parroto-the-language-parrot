/**
 * Parroto — gamification rules.
 *
 * Everything that makes a lesson "feel" like Duolingo lives here, as pure functions over a
 * plain user-state object: XP awards, streak arithmetic (including freezes), heart loss and
 * regeneration, daily-goal tracking, leagues, quests and achievements.
 *
 * Pure and dependency-free so every rule is unit-testable without touching the database.
 */

export const MAX_HEARTS = 5;
export const HEART_REGEN_MINUTES = 30;
export const HEART_REFILL_GEMS = 350;
export const STREAK_FREEZE_GEMS = 200;
export const XP_PER_LEVEL_COMPLETE = 15;
export const XP_PER_PRACTICE = 10;
export const XP_PER_PERFECT_STORY = 20;

/** Local calendar day key ('YYYY-MM-DD'). Streaks are day-based, not 24h-based. */
export function dayKey(date = new Date(), tzOffsetMinutes = undefined) {
  const d = new Date(date.getTime());
  if (tzOffsetMinutes !== undefined) {
    // Shift into the user's local day so a late-night lesson still counts today.
    d.setMinutes(d.getMinutes() + tzOffsetMinutes);
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Whole days between two day keys. */
export function daysBetween(a, b) {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  return Math.round((db - da) / 86400000);
}

/**
 * XP for finishing a lesson. Longer sessions and perfect runs pay more.
 */
export function lessonXp({ kind = "lesson", correct, total, comboMax = 0, timed = false }) {
  const base = kind === "story" ? XP_PER_PERFECT_STORY
             : kind === "practice" || kind === "review" || kind === "mistakes" || kind === "placement"
               ? XP_PER_PRACTICE
             : XP_PER_LEVEL_COMPLETE;
  const accuracy = total > 0 ? correct / total : 1;
  const accuracyBonus = Math.round(base * 0.5 * accuracy);
  const comboBonus = Math.min(10, Math.floor(comboMax / 5));
  const speedBonus = timed ? 5 : 0;
  return base + accuracyBonus + comboBonus + speedBonus;
}

/**
 * Heart loss on a wrong answer. Practice sessions never cost hearts (Duolingo behaviour:
 * mistakes in practice just requeue the item).
 */
export function heartsForMistake(kind) {
  return kind === "lesson" || kind === "story" ? 1 : 0;
}

/** Regenerates one heart per HEART_REGEN_MINUTES since the last update. */
export function regenerateHearts(user, now = Date.now()) {
  if (user.hearts >= MAX_HEARTS) {
    return { hearts: user.hearts, heartsUpdatedAt: now, gained: 0 };
  }
  const last = user.heartsUpdatedAt || now;
  const elapsedMin = (now - last) / 60000;
  const gained = Math.floor(elapsedMin / HEART_REGEN_MINUTES);
  if (gained <= 0) return { hearts: user.hearts, heartsUpdatedAt: last, gained: 0 };

  const hearts = Math.min(MAX_HEARTS, user.hearts + gained);
  // Keep the leftover minutes so progress is not reset on every check.
  const consumedMs = gained * HEART_REGEN_MINUTES * 60000;
  return { hearts, heartsUpdatedAt: last + consumedMs, gained: hearts - user.hearts };
}

export function minutesToNextHeart(user, now = Date.now()) {
  if (user.hearts >= MAX_HEARTS) return 0;
  const last = user.heartsUpdatedAt || now;
  const into = (now - last) / 60000;
  return Math.max(0, Math.ceil(HEART_REGEN_MINUTES - (into % HEART_REGEN_MINUTES)));
}

/**
 * Advances the streak for a lesson completed on `today`.
 *
 * Rules (matching Duolingo's observable behaviour):
 *  - same day again: no change
 *  - next day: +1
 *  - gap of 2+ days: reset to 1, unless a streak freeze covers exactly one missed day
 */
export function advanceStreak(user, today) {
  const last = user.lastPracticeDay;
  if (!last) {
    return { streak: 1, longestStreak: Math.max(1, user.longestStreak || 0), lastPracticeDay: today, streakFreezes: user.streakFreezes || 0, freezeUsedDay: user.freezeUsedDay };
  }
  const gap = daysBetween(last, today);
  if (gap <= 0) {
    return { streak: user.streak, longestStreak: user.longestStreak, lastPracticeDay: last, streakFreezes: user.streakFreezes || 0, freezeUsedDay: user.freezeUsedDay };
  }
  if (gap === 1) {
    const streak = (user.streak || 0) + 1;
    return {
      streak,
      longestStreak: Math.max(streak, user.longestStreak || 0),
      lastPracticeDay: today,
      streakFreezes: user.streakFreezes || 0,
      freezeUsedDay: user.freezeUsedDay,
    };
  }

  // One missed day can be covered by a freeze, if the user has one and has not used it today.
  const missed = gap - 1;
  const freezes = user.streakFreezes || 0;
  if (missed === 1 && freezes > 0 && user.freezeUsedDay !== today) {
    const streak = (user.streak || 0) + 1;
    return {
      streak,
      longestStreak: Math.max(streak, user.longestStreak || 0),
      lastPracticeDay: today,
      streakFreezes: freezes - 1,
      freezeUsedDay: today,
      usedFreeze: true,
    };
  }

  return {
    streak: 1,
    longestStreak: Math.max(1, user.longestStreak || 0),
    lastPracticeDay: today,
    streakFreezes: freezes,
    freezeUsedDay: user.freezeUsedDay,
    lostStreak: user.streak || 0,
  };
}

/** Which day-count buckets a streak falls into, for the "flame" UI. */
export function streakTier(streak) {
  if (streak >= 365) return "legendary";
  if (streak >= 100) return "obsidian";
  if (streak >= 30) return "diamond";
  if (streak >= 14) return "gold";
  if (streak >= 7) return "silver";
  if (streak >= 3) return "bronze";
  return "starter";
}

/** Tracks the rolling daily XP total, resetting when the local day changes. */
export function addDailyXp(user, xp, today) {
  const sameDay = user.dailyXpDay === today;
  return {
    dailyXp: (sameDay ? user.dailyXp || 0 : 0) + xp,
    dailyXpDay: today,
  };
}

export function dailyGoalMet(user, today) {
  return (user.dailyXpDay === today ? user.dailyXp || 0 : 0) >= (user.dailyGoal || 20);
}

// ---------------------------------------------------------------- leagues

export const LEAGUES = ["bronze", "silver", "gold", "sapphire", "ruby", "emerald", "diamond", "obsidian"];

/** League movement after a week: top 3 promote, bottom 3 demote. */
export function leagueOutcome(rank, totalPlayers) {
  if (totalPlayers <= 3) return "stay";
  if (rank <= 3) return "promote";
  if (rank > totalPlayers - 3) return "demote";
  return "stay";
}

export function nextLeague(league, outcome) {
  const i = Math.max(0, LEAGUES.indexOf(league));
  if (outcome === "promote") return LEAGUES[Math.min(LEAGUES.length - 1, i + 1)];
  if (outcome === "demote") return LEAGUES[Math.max(0, i - 1)];
  return league;
}

/** ISO week key, used as the leaderboard bucket. */
export function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- quests

/** The daily quest set. Rotates deterministically so every user sees the same trio per day. */
export function dailyQuests(today) {
  const all = [
    { id: "earn_xp", goal: 30, label: "Earn 30 XP", kind: "xp" },
    { id: "complete_lessons", goal: 3, label: "Complete 3 lessons", kind: "lessons" },
    { id: "perfect_lessons", goal: 1, label: "Finish a lesson with no mistakes", kind: "perfect" },
    { id: "score_combo", goal: 15, label: "Reach a 15-answer combo", kind: "combo" },
    { id: "review_items", goal: 10, label: "Review 10 words", kind: "review" },
    { id: "learn_new", goal: 5, label: "Learn 5 new words", kind: "new_words" },
    { id: "speak_practice", goal: 5, label: "Complete 5 speaking exercises", kind: "speak" },
    { id: "listen_practice", goal: 5, label: "Complete 5 listening exercises", kind: "listen" },
  ];
  // Deterministic rotation: seed from the day key so it is stable within a day.
  let hash = 0;
  for (const ch of today) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const picked = [];
  for (let i = 0; i < 3; i++) picked.push(all[(hash + i * 3) % all.length]);
  // Guard against duplicates from the stride colliding.
  return [...new Map(picked.map((q) => [q.id, q])).values()];
}

// ---------------------------------------------------------------- achievements

export const ACHIEVEMENTS = [
  { id: "first_lesson", label: "First Steps", hint: "Complete your first lesson" },
  { id: "streak_7", label: "Wildfire", hint: "Reach a 7 day streak" },
  { id: "streak_30", label: "Unstoppable", hint: "Reach a 30 day streak" },
  { id: "streak_100", label: "Centurion", hint: "Reach a 100 day streak" },
  { id: "xp_100", label: "Getting Warm", hint: "Earn 100 XP" },
  { id: "xp_1000", label: "Scholar", hint: "Earn 1000 XP" },
  { id: "crown_10", label: "Crown Collector", hint: "Earn 10 crowns" },
  { id: "perfect_5", label: "Flawless", hint: "Finish 5 lessons without a mistake" },
  { id: "combo_25", label: "In The Zone", hint: "Reach a 25 answer combo" },
  { id: "words_100", label: "Wordsmith", hint: "Learn 100 words" },
];

/** Returns achievement ids newly earned given the current totals. */
export function earnedAchievements(totals) {
  const { lessonsCompleted = 0, streak = 0, xp = 0, crowns = 0, perfectLessons = 0, bestCombo = 0, wordsLearned = 0 } = totals;
  const got = [];
  if (lessonsCompleted >= 1) got.push("first_lesson");
  if (streak >= 7) got.push("streak_7");
  if (streak >= 30) got.push("streak_30");
  if (streak >= 100) got.push("streak_100");
  if (xp >= 100) got.push("xp_100");
  if (xp >= 1000) got.push("xp_1000");
  if (crowns >= 10) got.push("crown_10");
  if (perfectLessons >= 5) got.push("perfect_5");
  if (bestCombo >= 25) got.push("combo_25");
  if (wordsLearned >= 100) got.push("words_100");
  return got;
}

/** Combo multiplier tier, used for the little "combo" flair in the UI. */
export function comboTier(combo) {
  if (combo >= 25) return 4;
  if (combo >= 15) return 3;
  if (combo >= 8) return 2;
  if (combo >= 3) return 1;
  return 0;
}
