/**
 * Parroto — HTTP server.
 *
 * A thin router over Service: parse, authenticate, delegate, serialise. Uses only Node's
 * built-in http module, so there is nothing to install. Static files are served from
 * `public/`, and the whole API lives under `/api/`.
 *
 * Start this through `bin/parroto.mjs` (i.e. `npm start`), which adds `--experimental-sqlite`
 * on the Node versions that need it. ESM imports are hoisted, so that cannot be handled here.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openDatabase } from "./db.mjs";
import { Service, AppError } from "./service.mjs";
import { EXERCISE_TYPES } from "./core/exercises.mjs";
import { COURSES, storiesFor } from "./content/courses.mjs";
import { LEAGUES, ACHIEVEMENTS, MAX_HEARTS, HEART_REFILL_GEMS, STREAK_FREEZE_GEMS } from "./core/gamification.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "..", "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

export function createApp({ dbPath = "data/parroto.db", db = null } = {}) {
  const database = db ?? openDatabase(dbPath);
  const service = new Service(database);

  const routes = buildRoutes(service);

  const server = createServer(async (req, res) => {
    const started = Date.now();
    try {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      const path = url.pathname;

      // ---- API
      if (path.startsWith("/api/")) {
        const body = await readBody(req);
        const token = bearer(req) ?? (body && body.__token) ?? url.searchParams.get("token");
        const user = service.userForToken(token);
        const match = matchRoute(routes, req.method, path);
        if (!match) {
          throw new AppError(404, "no_route", `No route for ${req.method} ${path}`);
        }
        const ctx = {
          req, res, url, body: body ?? {}, user, service, token,
          params: match.params,
          query: Object.fromEntries(url.searchParams),
        };
        if (match.route.auth && !user) throw new AppError(401, "unauthorized", "Sign in first");
        const out = await match.route.handler(ctx);
        return sendJson(res, out?.status ?? 200, out?.body ?? out);
      }

      // ---- static
      if (req.method === "GET" || req.method === "HEAD") {
        return await serveStatic(res, path);
      }
      throw new AppError(404, "no_route", "Not found");
    } catch (err) {
      if (err instanceof AppError) {
        return sendJson(res, err.status, { error: err.code, message: err.message, ...err.extra });
      }
      // eslint-disable-next-line no-console
      console.error(`[parroto] ${req.method} ${req.url} failed:`, err);
      return sendJson(res, 500, { error: "internal", message: "Something went wrong on our side." });
    } finally {
      if (process.env.PARROTO_LOG) {
        // eslint-disable-next-line no-console
        console.log(`[parroto] ${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
      }
    }
  });

  server.service = service;
  server.database = database;
  return server;
}

// ---------------------------------------------------------------------- routing

function buildRoutes(service) {
  const R = [];
  const add = (method, path, handler, { auth = true } = {}) =>
    R.push({ method, path, handler, auth, parts: path.split("/").filter(Boolean) });

  // ---- meta
  add("GET", "/api/health", () => ({
    ok: true, service: "parroto", time: new Date().toISOString(),
    exerciseTypes: EXERCISE_TYPES,
  }), { auth: false });

  add("GET", "/api/meta", () => ({
    courses: service.courses(),
    exerciseTypes: EXERCISE_TYPES,
    leagues: LEAGUES,
    achievements: ACHIEVEMENTS,
    maxHearts: MAX_HEARTS,
    heartRefillGems: HEART_REFILL_GEMS,
    streakFreezeGems: STREAK_FREEZE_GEMS,
  }), { auth: false });

  // ---- auth
  add("POST", "/api/register", ({ body, service: s }) => {
    const user = s.register(body ?? {});
    return { status: 201, body: { token: s.createSession(user.id), user } };
  }, { auth: false });

  add("POST", "/api/login", ({ body, service: s }) => {
    const row = s.authenticate(body?.username, body?.password);
    const user = s.publicUser(row);
    return { token: s.createSession(row.id), user };
  }, { auth: false });

  add("POST", "/api/logout", ({ service: s, token }) => { s.destroySession(token); return { ok: true }; });

  // ---- account
  add("GET", "/api/me", ({ user, service: s }) => ({ user: s.publicUser(user) }));
  add("PATCH", "/api/me", ({ user, body, service: s }) => ({
    user: s.updateSettings(user.id, body ?? {}),
  }));

  // ---- home
  add("GET", "/api/home", ({ user, query, service: s }) => s.home(user.id, query.day ?? null));

  // ---- courses
  add("GET", "/api/courses", () => ({ courses: service.courses() }));
  add("GET", "/api/courses/:courseId", ({ user, params, service: s }) =>
    s.courseState(user.id, params.courseId));
  add("POST", "/api/courses/:courseId/enrol", ({ user, params, service: s }) =>
    s.enrol(user.id, params.courseId));
  add("POST", "/api/courses/:courseId/switch", ({ user, params, service: s }) =>
    s.switchCourse(user.id, params.courseId));

  add("GET", "/api/courses/:courseId/stories/:storyId", ({ user, params, service: s }) => {
    if (!COURSES.some((c) => c.id === params.courseId)) {
      throw new AppError(404, "not_found", "No such course");
    }
    const story = storiesFor(params.courseId).find((x) => x.id === params.storyId);
    if (!story) throw new AppError(404, "not_found", "No such story");
    const meta = s.courseState(user.id, params.courseId).stories.find((x) => x.id === params.storyId);
    if (meta && !meta.unlocked) {
      throw new AppError(409, "story_locked",
        `Finish ${story.requiresSkills} skills to unlock this story`);
    }
    return { story };
  });

  // ---- lessons
  add("POST", "/api/lessons", ({ user, body, service: s }) => s.startSession(user.id, body ?? {}));
  add("POST", "/api/lessons/:id/answer", ({ user, params, body, service: s }) =>
    s.answer(user.id, params.id, body ?? {}));
  add("GET", "/api/lessons/:id", ({ user, params, service: s }) => {
    const row = service.database.prepare(
      "SELECT * FROM lesson_sessions WHERE id = ? AND user_id = ?").get(params.id, user.id);
    if (!row) throw new AppError(404, "not_found", "No such session");
    const state = JSON.parse(row.state);
    return {
      id: row.id, kind: row.kind, finished: !!row.finished_at, summary: row.summary ? JSON.parse(row.summary) : null,
      answered: state.answered, correct: state.correct, total: state.exercises.length,
    };
  });
  // The authoritative "what should I be showing right now?" call, used to recover from a
  // desync without losing progress.
  add("GET", "/api/lessons/:id/exercise", ({ user, params, service: s }) =>
    s.currentExercise(user.id, params.id));

  // Hint ladder: a GET previews the available rungs, a POST serves one of them.
  add("GET", "/api/lessons/:id/hints", ({ user, params, query, service: s }) =>
    s.hint(user.id, params.id, { exerciseId: query.exerciseId }));
  add("POST", "/api/lessons/:id/hint", ({ user, params, body, service: s }) =>
    s.hint(user.id, params.id, body ?? {}));

  // ---- practice / review
  add("POST", "/api/practice", ({ user, body, service: s }) =>
    s.startSession(user.id, { ...body, kind: "practice" }));
  add("POST", "/api/review", ({ user, body, service: s }) =>
    s.startSession(user.id, { ...body, kind: "review" }));

  // ---- economy
  add("POST", "/api/shop/hearts", ({ user, service: s }) => s.refillHearts(user.id));
  add("POST", "/api/shop/streak-freeze", ({ user, service: s }) => s.buyStreakFreeze(user.id));

  // ---- social / meta screens
  add("GET", "/api/quests", ({ user, query, service: s }) => ({
    quests: s.quests(user.id, query.day ?? undefined),
  }));
  add("POST", "/api/quests/:questId/claim", ({ user, params, query, service: s }) =>
    s.claimQuest(user.id, params.questId, query.day ?? undefined));
  add("GET", "/api/achievements", ({ user, service: s }) => ({ achievements: s.achievements(user.id) }));
  add("GET", "/api/leaderboard", ({ user, query, service: s }) =>
    s.leaderboard(user.id, query.week ?? undefined));
  add("GET", "/api/stats", ({ user, service: s }) => {
    const u = service.getUser(user.id);
    return {
      user: service.publicUser(u),
      achievements: service.achievements(user.id),
      courses: service.myCourses(user.id),
      exerciseTypes: EXERCISE_TYPES.length,
      // Daily lesson counts for the activity sparkline. Bucketed in JS rather than SQL so it
      // does not depend on SQLite's date functions being compiled in.
      activity: [...service.database.prepare(`
        SELECT started_at, passed FROM lesson_sessions
        WHERE user_id = ? AND passed = 1
        ORDER BY started_at DESC LIMIT 500
      `).all(user.id)].reduce((acc, row) => {
        const day = new Date(row.started_at).toISOString().slice(0, 10);
        acc[day] = (acc[day] ?? 0) + 1;
        return acc;
      }, {}),
    };
  });

  return R;
}

function matchRoute(routes, method, path) {
  const parts = path.split("/").filter(Boolean);
  for (const route of routes) {
    if (route.method !== method) continue;
    if (route.parts.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < route.parts.length; i++) {
      const rp = route.parts[i];
      if (rp.startsWith(":")) params[rp.slice(1)] = decodeURIComponent(parts[i]);
      else if (rp !== parts[i]) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return null;
}

// ---------------------------------------------------------------------- transport

function bearer(req) {
  const h = req.headers.authorization;
  if (h && /^bearer /i.test(h)) return h.slice(7).trim();
  return null;
}

async function readBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new AppError(413, "too_large", "Request too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  const type = req.headers["content-type"] ?? "";
  if (type.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError(400, "bad_json", "Body must be valid JSON");
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function serveStatic(res, path) {
  let rel = path === "/" ? "/index.html" : path;
  // Prevent path traversal.
  const target = resolve(join(PUBLIC_DIR, normalize(rel).replace(/^(\.\.[/\\])+/, "")));
  if (!target.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { error: "forbidden" });
  }
  try {
    const info = await stat(target);
    if (info.isDirectory()) return serveStatic(res, join(rel, "index.html"));
    const data = await readFile(target);
    res.writeHead(200, {
      "content-type": MIME[extname(target)] ?? "application/octet-stream",
      "content-length": data.length,
      "cache-control": "no-cache",
    });
    res.end(data);
  } catch {
    // Unknown path: if it looks like a route, let the SPA handle it.
    if (!extname(rel)) {
      try {
        const html = await readFile(join(PUBLIC_DIR, "index.html"));
        res.writeHead(200, { "content-type": MIME[".html"], "content-length": html.length });
        return res.end(html);
      } catch { /* fall through */ }
    }
    sendJson(res, 404, { error: "not_found", message: `No such file: ${rel}` });
  }
}

// ---------------------------------------------------------------------- boot

/**
 * Starts the HTTP server. Exported so a launcher can start it explicitly — relying on an
 * `argv[1].endsWith("server.mjs")` check silently does nothing when the app is entered through
 * `bin/parroto.mjs` instead.
 */
export function startServer({
  port = Number(process.env.PORT ?? 5175),
  dbPath = process.env.PARROTO_DB ?? "data/parroto.db",
  quiet = false,
} = {}) {
  const server = createApp({ dbPath });
  server.listen(port, () => {
    if (quiet) return;
    // eslint-disable-next-line no-console
    console.log(`🦜 Parroto is up on http://localhost:${port}`);
    console.log(`   database: ${dbPath}`);
    console.log(`   courses:  ${COURSES.map((c) => `${c.flag} ${c.name}`).join("  ")}`);
  });
  const shutdown = () => { server.close(() => process.exit(0)); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return server;
}

// Starting the file directly still works, for convenience.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) startServer();
