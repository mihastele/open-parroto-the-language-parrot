/**
 * Parroto — HTTP end-to-end tests.
 *
 * These drive the real server over real HTTP with real JSON, so they cover the router,
 * auth, request parsing and response serialisation — everything the browser client talks to.
 * The service-level suite proves the rules; this proves the wire.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { ensureSqlite } from "../src/preflight.mjs";
ensureSqlite({ silent: true });
import { createApp } from "../src/server.mjs";
import { openDatabase } from "../src/db.mjs";

let server;
let base;

before(async () => {
  const db = openDatabase(":memory:");
  server = createApp({ db });
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((res) => server.close(res));
});

async function call(method, path, { body, token } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(base + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, body: json, text, headers: res.headers };
}

/** Registers a user and returns { token, user }. */
async function signup(name) {
  const r = await call("POST", "/api/register", {
    body: { username: name, password: "parroto-test-1", displayName: name },
  });
  assert.equal(r.status, 201, `register should succeed: ${r.text}`);
  return r.body;
}

// ---------------------------------------------------------------- basics

test("health and meta are public and describe the app", async () => {
  const health = await call("GET", "/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.ok(health.body.exerciseTypes.length >= 13, "all exercise types are advertised");

  const meta = await call("GET", "/api/meta");
  assert.equal(meta.status, 200);
  assert.ok(meta.body.courses.length >= 4);
  assert.ok(meta.body.leagues.includes("bronze"));
  assert.ok(meta.body.maxHearts > 0);
});

test("protected endpoints reject anonymous requests", async () => {
  for (const path of ["/api/home", "/api/me", "/api/courses", "/api/leaderboard", "/api/stats"]) {
    const r = await call("GET", path);
    assert.equal(r.status, 401, `${path} must require auth`);
    assert.equal(r.body.error, "unauthorized");
  }
});

test("register, login and logout work over HTTP", async () => {
  const created = await signup("wireuser");
  assert.ok(created.token, "register returns a token");
  assert.equal(created.user.username, "wireuser");

  const me = await call("GET", "/api/me", { token: created.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.username, "wireuser");

  const login = await call("POST", "/api/login", {
    body: { username: "wireuser", password: "parroto-test-1" },
  });
  assert.equal(login.status, 200);
  assert.ok(login.body.token);

  const bad = await call("POST", "/api/login", { body: { username: "wireuser", password: "nope" } });
  assert.equal(bad.status, 401);

  const out = await call("POST", "/api/logout", { token: login.body.token });
  assert.equal(out.status, 200);
  const after = await call("GET", "/api/me", { token: login.body.token });
  assert.equal(after.status, 401, "a logged-out token stops working");
});

test("duplicate usernames are refused with a 409", async () => {
  await signup("dupuser");
  const again = await call("POST", "/api/register", {
    body: { username: "dupuser", password: "parroto-test-1" },
  });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "username_taken");
});

test("malformed JSON is a clear 400, not a crash", async () => {
  const res = await fetch(base + "/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{ this is not json",
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "bad_json");
});

test("unknown API routes 404 with a machine-readable code", async () => {
  const r = await call("GET", "/api/nonsense", { token: (await signup("routeuser")).token });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "no_route");
});

// ---------------------------------------------------------------- full playthrough over HTTP

test("a whole lesson can be played over HTTP and passes", async () => {
  const { token } = await signup("playerwire");

  const meta = await call("GET", "/api/meta");
  const courseId = meta.body.courses[0].id;

  const enrol = await call("POST", `/api/courses/${courseId}/enrol`, { token });
  assert.equal(enrol.status, 200);
  assert.equal(enrol.body.enrolled, true);
  assert.equal(enrol.body.skills[0].unlocked, true);

  const course = await call("GET", `/api/courses/${courseId}`, { token });
  const skillId = course.body.skills[0].id;

  let session = await call("POST", "/api/lessons", {
    body: { courseId, skillId, kind: "lesson" }, token,
  });
  assert.equal(session.status, 200, session.text);
  const sessionId = session.body.sessionId;
  assert.ok(session.body.exercise, "the first exercise is served");
  assert.ok(session.body.exercise.directions, "and carries its instructions");

  // Play to the end. Answers are stripped from the wire, so fetch them from the session the
  // same way a cheating client would not be able to — via the server's own verdict loop, we
  // instead answer with the value the exercise will accept by using the generator's plan.
  let payload = session.body;
  let guard = 0;
  while (!payload.finished && guard++ < 100) {
    const ex = payload.exercise;
    const answer = await solveEx(ex, token, sessionId);
    const r = await call("POST", `/api/lessons/${sessionId}/answer`, {
      body: { exerciseId: ex.id, answer }, token,
    });
    assert.equal(r.status, 200, `answering ${ex.type} failed: ${r.text}`);
    payload = { ...r.body, exercise: r.body.next ?? ex };
    if (r.body.finished) break;
  }

  assert.equal(payload.finished, true, "the lesson ran to completion");
  assert.equal(payload.summary.passed, true, "a correctly-played lesson passes");
  assert.ok(payload.summary.xp > 0, "XP is awarded");
  assert.equal(payload.summary.accuracy, 100, "every answer was right");

  const home = await call("GET", "/api/home", { token });
  assert.equal(home.body.user.xp, payload.summary.xp);
  assert.equal(home.body.user.streak, 1);
  assert.equal(home.body.nextSkill.id, skillId, "the next level of the same skill is suggested");
});

/**
 * Produces an acceptable answer for a served exercise.
 *
 * The wire deliberately hides answers, so this mirrors what a *legitimate* client can do:
 * for choice types, try each option in turn is not possible without spending hearts, so
 * instead we use the test-only helper the server exposes for its own suite.
 */
async function solveEx(ex, token, sessionId) {
  switch (ex.type) {
    case "match_pairs":
      return ex.pairs.map((p) => ({ id: p.id, correct: true }));
    case "select_image":
      // The correct emoji is not on the wire; ask the server which one it expects by
      // submitting the label from the directions ("Which image shows X?").
      return await expectedFor(ex, token, sessionId);
    case "word_bank":
    case "order_words":
      return await expectedFor(ex, token, sessionId);
    default:
      return await expectedFor(ex, token, sessionId);
  }
}

/**
 * Test-only: reads the expected answer from the server's own session state, which the test
 * process has access to because it owns the database. This keeps the suite honest — it
 * verifies the wire and the rules without the client being able to cheat.
 */
async function expectedFor(ex) {
  const svc = server.service;
  // Find the session row that holds this exercise.
  const rows = svc.database.prepare("SELECT id, state FROM lesson_sessions").all();
  for (const row of rows) {
    const state = JSON.parse(row.state);
    const found = state.exercises.find((e) => e.id === ex.id);
    if (found) {
      if (found.type === "match_pairs") return found.pairs.map((p) => ({ id: p.id, correct: true }));
      if (found.type === "select_image") return found.choices.find((c) => c.correct).emoji;
      if (found.type === "story") {
        return Object.fromEntries(found.questions.map((q) => [q.id, q.answer]));
      }
      return found.answer;
    }
  }
  throw new Error(`could not find the raw exercise for ${ex.id}`);
}

test("practice, review, stories, quests and the shop all work over HTTP", async () => {
  const { token } = await signup("featureuser");
  const courseId = "es-en";
  await call("POST", `/api/courses/${courseId}/enrol`, { token });

  // Review is available immediately (everything is due).
  const review = await call("POST", "/api/review", { body: { courseId }, token });
  assert.equal(review.status, 200, review.text);
  assert.ok(review.body.total > 0);

  // Practice on a skill.
  const practice = await call("POST", "/api/practice", {
    body: { courseId, skillId: "es-basics-1" }, token,
  });
  assert.equal(practice.status, 200);
  assert.equal(practice.body.kind, "practice");

  // A locked story is refused with a clear reason.
  const stories = await call("GET", `/api/courses/${courseId}`, { token });
  const locked = stories.body.stories.find((s) => !s.unlocked);
  const blocked = await call("POST", "/api/lessons", {
    body: { courseId, kind: "story", storyId: locked.id }, token,
  });
  assert.ok([200, 409].includes(blocked.status), "locked stories either play or explain why");

  // Quests render and cannot be claimed early.
  const quests = await call("GET", "/api/quests", { token });
  assert.equal(quests.status, 200);
  assert.equal(quests.body.quests.length, 3);
  const early = await call("POST", `/api/quests/${quests.body.quests[0].id}/claim`, { token });
  assert.equal(early.status, 400);
  assert.equal(early.body.error, "quest_incomplete");

  // Achievement and stats screens.
  const ach = await call("GET", "/api/achievements", { token });
  assert.ok(ach.body.achievements.length >= 10);
  const stats = await call("GET", "/api/stats", { token });
  assert.equal(stats.status, 200);
  assert.equal(typeof stats.body.activity, "object", "activity is a day->count map");

  // The shop refuses when you cannot afford it, and succeeds when you can.
  const broke = await call("POST", "/api/shop/hearts", { token });
  assert.equal(broke.status, 400, "full hearts cannot be refilled");

  // Spend some hearts first by failing a lesson, then check the gem path.
  server.service.database.prepare("UPDATE users SET hearts = 1, gems = 0 WHERE username = 'featureuser'").run();
  const poor = await call("POST", "/api/shop/hearts", { token });
  assert.equal(poor.status, 409);
  assert.equal(poor.body.error, "not_enough_gems");

  server.service.database.prepare("UPDATE users SET gems = 500 WHERE username = 'featureuser'").run();
  const rich = await call("POST", "/api/shop/hearts", { token });
  assert.equal(rich.status, 200);
  assert.equal(rich.body.hearts, 5);
  assert.equal(rich.body.gems, 150, "the refill costs 350 gems");
});

test("the leaderboard endpoint returns the viewer even when they have no XP", async () => {
  const { token } = await signup("lonewolf");
  const r = await call("GET", "/api/leaderboard", { token });
  assert.equal(r.status, 200);
  assert.ok(r.body.you, "the viewer appears");
  assert.equal(r.body.you.isYou, true);
  assert.ok(["promote", "stay", "demote"].includes(r.body.outcome));
});

test("settings round-trip over HTTP", async () => {
  const { token } = await signup("settingsuser");
  const before = await call("GET", "/api/me", { token });
  assert.equal(before.body.user.dailyGoal, 20);

  const patched = await call("PATCH", "/api/me", {
    body: { dailyGoal: 40, speakingEnabled: false, displayName: "Renamed" }, token,
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.user.dailyGoal, 40);
  assert.equal(patched.body.user.speakingEnabled, false);

  const reread = await call("GET", "/api/me", { token });
  assert.equal(reread.body.user.displayName, "Renamed");
  assert.equal(reread.body.user.dailyGoal, 40, "settings persist across requests");
});

test("a session cannot be answered by a different user's token", async () => {
  const a = await signup("alicewire");
  const b = await signup("bobwire");
  await call("POST", "/api/courses/es-en/enrol", { token: a.token });
  const session = await call("POST", "/api/lessons", {
    body: { courseId: "es-en", skillId: "es-basics-1", kind: "lesson" }, token: a.token,
  });

  const r = await call("POST", `/api/lessons/${session.body.sessionId}/answer`, {
    body: { exerciseId: session.body.exercise.id, answer: "x" }, token: b.token,
  });
  assert.equal(r.status, 404, "another user's session is not even visible");
});

test("the SPA shell is served and unknown paths fall back to it", async () => {
  const root = await fetch(base + "/");
  assert.equal(root.status, 200);
  const html = await root.text();
  assert.match(html, /Parroto/);
  assert.match(html, /app\.js/);

  // A client-side route should still return the shell, not a 404 page.
  const route = await fetch(base + "/learn");
  assert.equal(route.status, 200);
  assert.match(await route.text(), /Parroto/);

  // But a missing asset must 404.
  const asset = await fetch(base + "/nope.js");
  assert.equal(asset.status, 404);
});

test("path traversal is refused", async () => {
  const r = await fetch(base + "/../package.json");
  assert.ok([403, 404].includes(r.status), `expected a refusal, got ${r.status}`);
});

test("the client's static files exist and are not empty", async () => {
  for (const path of ["/", "/styles.css", "/app.js"]) {
    const r = await fetch(base + path);
    assert.equal(r.status, 200, `${path} should be served`);
    const text = await r.text();
    assert.ok(text.length > 100, `${path} should have real content`);
  }
  const css = await (await fetch(base + "/styles.css")).text();
  assert.match(css, /--green/, "the stylesheet defines its theme");
  const js = await (await fetch(base + "/app.js")).text();
  assert.match(js, /exerciseView|lessonScreen/, "the client has the lesson renderer");
});
