/* ==========================================================================
   Parroto — frontend
   A single-page app with no build step and no dependencies. Every screen is a
   function returning a DOM node; state lives in `state` and is saved to
   localStorage where it belongs on the client.
   ========================================================================== */

import { Sound } from "./sound.js";

const API = {
  token: localStorage.getItem("parroto.token") || null,

  async call(method, path, body) {
    const headers = { "content-type": "application/json" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
    if (!res.ok) {
      const err = new Error(data?.message || `Request failed (${res.status})`);
      err.code = data?.error;
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  },
  get(p) { return this.call("GET", p); },
  post(p, b) { return this.call("POST", p, b ?? {}); },
  patch(p, b) { return this.call("PATCH", p, b ?? {}); },

  setToken(t) {
    this.token = t;
    if (t) localStorage.setItem("parroto.token", t);
    else localStorage.removeItem("parroto.token");
  },
};

const state = {
  screen: "loading",
  user: null,
  home: null,
  course: null,
  session: null,        // { sessionId, exercise, index, total, hearts }
  pendingNext: null,    // the exercise to show after Continue, held while feedback is up
  feedback: null,
  hints: [],            // available hint rungs for the current exercise
  shownHints: [],       // hint steps the learner has revealed on this exercise
  hintSpent: false,     // a revealing hint was used, so this attempt is no longer clean
  lastAnswerAt: 0,      // for the speed bonus / rapid-tap guard
  story: null,
  answer: null,         // whatever the current exercise needs
  busy: false,
  day: localDay(),
};

/** The user's local calendar day, so streaks match their clock rather than the server's. */
function localDay(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// --------------------------------------------------------------------- helpers

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function toast(message, kind = "") {
  const box = document.getElementById("toasts");
  const t = el("div", { class: `toast ${kind}`, text: message });
  box.append(t);
  setTimeout(() => t.remove(), 3200);
}

function flagEmoji(c) { return c; }

function heartsRow(hearts, max = 5) {
  return el("span", { class: "stat hearts", title: `${hearts}/${max} hearts` },
    "❤️", String(hearts));
}

// --------------------------------------------------------------------- audio

/**
 * Speech uses the browser's built-in speech synthesis, so there are no audio files to ship.
 * Falls back silently when the browser has no voice for the language.
 */
const audio = {
  speak(text, lang = "es-ES", rate = 0.9) {
    if (!("speechSynthesis" in window)) { toast("Your browser has no speech support", "warn"); return; }
    if (!state.user?.soundEnabled) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = rate;
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang?.startsWith(lang.slice(0, 2)));
    if (voice) u.voice = voice;
    window.speechSynthesis.speak(u);
  },
};

/** Voice input for speak exercises. Uses Web Speech API; degrades to typing. */
function listenOnce(lang, onResult, onFail) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { onFail?.("no_support"); return null; }
  const rec = new SR();
  rec.lang = lang;
  rec.interimResults = false;
  rec.maxAlternatives = 3;
  rec.onresult = (e) => {
    const alts = [...e.results[0]].map((r) => r.transcript);
    onResult(alts[0], alts);
  };
  rec.onerror = (e) => onFail?.(e.error);
  rec.start();
  return rec;
}

// --------------------------------------------------------------------- render

function render() {
  const app = document.getElementById("app");
  const scrollY = window.scrollY;
  // Guard the shape of the pending answer: switching to an exercise of a different type
  // mid-flight used to render with the previous type's answer value and throw, leaving the
  // screen half-drawn and every button dead.
  const ex = state.session?.exercise;
  if (ex && !answerShapeOk(ex)) state.answer = emptyAnswer(ex);

  try {
    app.replaceChildren(view());
  } catch (err) {
    // Never leave the user with a blank or half-drawn screen.
    app.replaceChildren(el("div", { class: "center-screen" },
      el("div", { class: "q-emoji", text: "🙃" }),
      el("h1", { text: "Something went wrong" }),
      el("p", { class: "muted", text: String(err.message ?? err) }),
      el("button", {
        class: "btn btn-primary",
        onclick: () => { state.screen = "learn"; state.session = null; loadScreen(); },
      }, "Back to learning"),
    ));
  }

  if (state.screen !== "lesson") window.scrollTo(0, 0);
  else window.scrollTo(0, scrollY);
}

function view() {
  switch (state.screen) {
    case "loading": return el("div", { class: "spinner" });
    case "auth": return authScreen();
    case "courses": return coursePicker();
    case "learn": return learnScreen();
    case "lesson": return lessonScreen();
    case "story": return storyScreen();
    case "profile": return profileScreen();
    case "leaderboard": return leaderboardScreen();
    case "quests": return questsScreen();
    default: return el("div", { class: "center-screen" }, el("h1", { text: "Lost?" }));
  }
}

// --------------------------------------------------------------------- nav

function topbar(extra = []) {
  const u = state.user;
  return el("div", { class: "topbar" },
    el("div", { class: "brand" }, "🦜 Parro", el("span", { text: "to" })),
    el("div", { class: "grow" }),
    u ? el("span", { class: "stat streak", title: "day streak" }, "🔥", String(u.streak)) : null,
    u ? el("span", { class: "stat gems", title: "gems" }, "💎", String(u.gems)) : null,
    u ? el("span", { class: "stat hearts", title: "hearts" }, "❤️", String(u.hearts)) : null,
    ...extra,
  );
}

function nav() {
  const go = (screen) => { state.screen = screen; loadScreen(); };
  const item = (id, icon, label) => el("button", {
    class: state.screen === id ? "active" : "",
    onclick: () => go(id),
  }, el("span", { class: "ico", text: icon }), label);

  return el("div", { class: "nav" },
    item("learn", "🏠", "Learn"),
    item("quests", "📋", "Quests"),
    item("leaderboard", "🏆", "League"),
    item("profile", "🙂", "Profile"),
  );
}

function shell(content) {
  return el("div", { class: "screen" }, topbar(), content, nav());
}

// --------------------------------------------------------------------- auth

function authScreen() {
  const mode = state.authMode ?? "login";
  const username = el("input", { class: "text-input", placeholder: "username", autocomplete: "username" });
  const password = el("input", { class: "text-input", type: "password", placeholder: "password", autocomplete: "current-password" });
  const displayName = el("input", { class: "text-input", placeholder: "display name (optional)" });

  const submit = async () => {
    try {
      state.busy = true;
      const path = mode === "login" ? "/api/login" : "/api/register";
      const body = { username: username.value, password: password.value };
      if (mode === "register") body.displayName = displayName.value || username.value;
      const res = await API.post(path, body);
      API.setToken(res.token);
      state.user = res.user;
      await boot();
    } catch (err) {
      toast(err.message, "warn");
    } finally {
      state.busy = false;
    }
  };

  return el("div", { class: "center-screen" },
    el("div", { class: "q-emoji", text: "🦜" }),
    el("h1", { text: "Parroto" }),
    el("p", { class: "muted", text: "Learn a language by parroting it back." }),
    el("div", { class: "card", style: "width:100%;max-width:400px;margin-top:20px;text-align:left" },
      el("div", { class: "col" },
        username,
        password,
        mode === "register" ? displayName : null,
        el("button", { class: "btn btn-primary btn-wide", onclick: submit },
          mode === "login" ? "Sign in" : "Create account"),
        el("button", {
          class: "btn btn-ghost btn-wide",
          onclick: () => { state.authMode = mode === "login" ? "register" : "login"; render(); },
        }, mode === "login" ? "I need an account" : "I already have an account"),
      ),
    ),
    el("p", { class: "small muted", style: "margin-top:18px" },
      "Everything runs locally. Pick any username and a password of 6+ characters."),
  );
}

// --------------------------------------------------------------------- courses

function coursePicker() {
  const list = state.meta?.courses ?? [];
  return el("div", { class: "col" },
    el("h1", { text: "Pick a course" }),
    el("p", { class: "muted", text: "Four languages ship with Parroto. You can add more later." }),
    ...list.map((c) => el("button", {
      class: "course-pick",
      onclick: async () => {
        try {
          // Switching (not merely enrolling) is what makes the chosen course the active one,
          // so picking a course here actually takes you into it.
          await API.post(`/api/courses/${c.id}/switch`);
          await boot();
        } catch (e) { toast(e.message, "warn"); }
      },
    },
      el("span", { class: "flag", text: c.flag }),
      el("span", { class: "grow" },
        el("div", { class: "bold", style: "font-size:17px" }, c.name),
        el("div", { class: "small muted" },
          `${c.skillCount} skills · ${c.itemCount} words` +
          (c.storyCount ? ` · ${c.storyCount} ${c.storyCount === 1 ? "story" : "stories"}` : "")),
      ),
      el("span", { class: "muted", text: "›" }),
    )),
  );
}

// --------------------------------------------------------------------- learn

function learnScreen() {
  const home = state.home;
  const course = state.currentCourse ?? home?.currentCourse;
  if (!course) return shell(coursePicker());

  return shell(el("div", {},
    el("div", { class: "card", style: "background:linear-gradient(135deg,var(--green),#8ee000);color:#fff;border:none" },
      el("div", { class: "row-between" },
        el("div", {},
          el("div", { class: "small", style: "opacity:.9", text: "DAILY GOAL" }),
          el("div", { class: "bold", style: "font-size:22px" }, `${home.user.dailyXp} / ${home.user.dailyGoal} XP`),
        ),
        el("div", { style: "font-size:44px", text: "🎯" }),
      ),
      el("div", { class: "progress-track", style: "margin-top:12px;background:rgba(255,255,255,.35)" },
        el("div", {
          class: "progress-fill",
          style: `width:${Math.min(100, (home.user.dailyXp / home.user.dailyGoal) * 100)}%;background:#fff`,
        })),
    ),

    el("div", { class: "row-between", style: "margin-top:20px" },
      el("h2", { style: "margin:0" }, `${course.flag} ${course.name}`),
      el("span", { class: "pill gold" }, "👑", String(course.crowns)),
    ),

    el("div", { class: "row", style: "gap:10px;margin-bottom:14px" },
      el("button", {
        class: "btn btn-blue grow",
        onclick: () => startSession({ kind: "review" }),
      }, `Review ${home.dueCount || ""}`.trim()),
      el("button", {
        class: "btn btn-ghost",
        onclick: () => switchCourseDialog(),
      }, `Course ${course.flag}`),
    ),

    course.stories.filter((s) => s.unlocked).length
      ? el("div", { class: "row", style: "gap:10px;margin-bottom:14px;overflow-x:auto" },
          ...course.stories.map((s) => el("button", {
            class: "card tight",
            style: `min-width:150px;text-align:left;${s.unlocked ? "" : "opacity:.5"}`,
            disabled: !s.unlocked,
            onclick: () => startStory(s.id),
          },
            el("div", { style: "font-size:28px", text: s.icon }),
            el("div", { class: "bold", text: s.title }),
            el("div", { class: "small muted" }, s.unlocked ? `${s.questionCount} questions` : `🔒 needs ${s.requiresSkills} skills`),
          )),
        )
      : null,

    el("h3", { text: "Skills" }),
    ...course.skills.map((s) => skillNode(s, course)),
  ));
}

function skillNode(skill, course) {
  const crowns = [...Array(skill.maxLevel)].map((_, i) =>
    el("span", { style: i < skill.level ? "color:var(--gold)" : "color:var(--line)" }, "★"));

  return el("button", {
    class: `skill-node ${skill.unlocked ? "unlocked" : "locked"} ${skill.completed ? "completed" : ""}`,
    disabled: !skill.unlocked,
    onclick: () => {
      if (!skill.unlocked) return toast("Finish the previous skill first", "warn");
      startSession({ kind: "lesson", skillId: skill.id });
    },
  },
    el("span", { class: "badge", text: skill.unlocked ? iconFor(skill.icon) : "🔒" }),
    el("span", { class: "grow" },
      el("div", { class: "bold", text: skill.title }),
      el("div", { class: "small muted" },
        !skill.unlocked ? "Locked"
          : skill.completed ? `Mastered · ${skill.itemCount} words`
          : `Level ${skill.level + 1} of ${skill.maxLevel} · ${skill.learned}/${skill.itemCount} words seen`),
      el("div", { class: "crowns" }, ...crowns),
    ),
    skill.unlocked && skill.dueCount > 0
      ? el("span", { class: "pill blue" }, String(skill.dueCount), "due")
      : null,
  );
}

function iconFor(name) {
  return { chat: "💬", food: "🍎", people: "👨‍👩‍👧", paw: "🐾", plane: "✈️", quote: "❝", star: "⭐" }[name] ?? "📘";
}

// --------------------------------------------------------------------- lesson

async function startSession({ kind, skillId }) {
  try {
    state.busy = true;
    const res = await API.post("/api/lessons", {
      courseId: state.currentCourse.id, skillId, kind, clientDay: state.day,
    });
    state.session = res;
    state.pendingNext = null;
    state.answer = emptyAnswer(res.exercise);
    state.feedback = null;
    state.hintText = {};
    state.screen = "lesson";
    render();
    afterRenderForExercise(res.exercise);
    loadHints(res.exercise);
  } catch (err) {
    handleSessionError(err);
  } finally {
    state.busy = false;
  }
}

async function startStory(storyId) {
  try {
    state.busy = true;
    const res = await API.post("/api/lessons", {
      courseId: state.currentCourse.id, kind: "story", storyId, clientDay: state.day,
    });
    state.session = res;
    state.pendingNext = null;
    state.story = { id: storyId, page: 0, answers: {}, revealed: false };
    state.screen = "story";
    render();
  } catch (err) {
    handleSessionError(err);
  } finally {
    state.busy = false;
  }
}

function handleSessionError(err) {
  if (err.code === "no_hearts") {
    showDialog({
      emoji: "💔",
      title: "Out of hearts",
      body: `Hearts refill in ${err.data?.minutesToNextHeart ?? 30} minutes, or refill now for ${err.data?.refillCost ?? 350} gems. Practice is always free and never costs hearts.`,
      actions: [
        {
          label: `Refill (${err.data?.refillCost ?? 350} 💎)`, kind: "primary",
          onclick: async () => {
            try { await API.post("/api/shop/hearts"); closeDialog(); await loadScreen(); }
            catch (e) { toast(e.message, "warn"); }
          },
        },
        { label: "Not now", kind: "ghost", onclick: closeDialog },
      ],
    });
    return;
  }
  if (err.code === "nothing_due") { toast("Nothing is due for review — try a lesson!", "good"); return; }
  if (err.code === "skill_locked") { toast("Finish the previous skill first", "warn"); return; }
  if (err.code === "story_locked") { toast(err.message, "warn"); return; }
  toast(err.message || "Something went wrong", "warn");
}

/** Sets the exercise currently being shown and resets the answer to that type's shape. */
function setExercise(ex) {
  state.session = { ...state.session, exercise: ex };
  state.answer = emptyAnswer(ex);
}

function emptyAnswer(ex) {
  switch (ex?.type) {
    case "word_bank":
    case "order_words": return [];
    case "match_pairs": return { attempts: [], selectedLeft: null, selectedRight: null, matched: [] };
    case "story": return {};
    case "speak": return { transcript: "" };
    default: return null;
  }
}

/** Central place so the sound setting is honoured everywhere and audio can fail silently. */
function play(name, ...args) {
  if (!state.user?.soundEnabled) return;
  try { Sound[name]?.(...args); } catch { /* audio is never worth breaking the UI over */ }
}

/** Loads the hint ladder for the exercise now on screen. Safe to call on every exercise. */
async function loadHints(ex) {
  state.hints = [];
  state.shownHints = [];
  state.hintSpent = false;
  state.hintText = {};
  if (!ex || ex.type === "story" || !state.session?.sessionId) return;
  try {
    const res = await API.get(
      `/api/lessons/${state.session.sessionId}/hints?exerciseId=${encodeURIComponent(ex.id)}`);
    // Guard against a stale response landing after the learner already moved on.
    if (state.session?.exercise?.id !== ex.id) return;
    state.hints = res.hints ?? [];
    // The fetch is async and finishes after the render that triggered it, so the hint button
    // would never appear without this second render.
    if (state.screen === "lesson" && state.hints.length) render();
  } catch { /* hints are optional; a failure just means no hint button */ }
}

/** Reveals the next rung of the hint ladder. */
async function revealHint() {
  const next = state.hints.find((h) => !state.shownHints.includes(h.step));
  if (!next || state.busy) return;
  try {
    state.busy = true;
    const res = await API.post(`/api/lessons/${state.session.sessionId}/hint`, {
      exerciseId: state.session.exercise.id, step: next.step,
    });
    state.shownHints.push(next.step);
    state.hintText = { ...(state.hintText ?? {}), [next.step]: res.hint?.text ?? "" };
    if (res.spent) state.hintSpent = true;
    play(next.costsAttempt ? "whoosh" : "tap", false);
    if (res.hint?.action === "play_slow") {
      audio.speak(state.session.exercise.answer ?? state.session.exercise.prompt,
                  state.session.exercise.tts, 0.5);
    }
    render();
  } catch (e) {
    toast(e.message ?? "Could not load a hint", "warn");
  } finally {
    state.busy = false;
  }
}

/** True when the current answer value matches the shape this exercise needs. */
function answerShapeOk(ex) {
  const a = state.answer;
  switch (ex?.type) {
    case "word_bank":
    case "order_words": return Array.isArray(a);
    case "match_pairs": return a && Array.isArray(a.matched);
    case "speak": return typeof a?.transcript === "string";
    case "story": return a && typeof a === "object";
    default: return true;
  }
}

function lessonScreen() {
  const s = state.session;
  if (!s?.exercise) return el("div", { class: "spinner" });

  const ex = s.exercise;
  const progress = s.total > 0 ? s.index / s.total : 0;

  return el("div", { class: "screen" },
    el("div", { class: "lesson-top" },
      el("button", { class: "btn btn-ghost", style: "padding:8px 12px", onclick: confirmQuit }, "✕"),
      el("div", { class: "progress-track" },
        el("div", { class: "progress-fill", style: `width:${progress * 100}%` })),
      heartsRow(s.hearts),
    ),
    el("div", { class: "row-between", style: "margin-bottom:6px" },
      el("span", { class: "small muted" },
        `${s.index + 1} / ${s.total}`,
        ex.isRetry ? el("span", { class: "pill blue", style: "margin-left:8px" }, "🔁 second try") : null,
        state.hintSpent ? el("span", { class: "pill", style: "margin-left:8px" }, "💡 hinted") : null,
      ),
      // The combo counter is the single biggest driver of "one more go" — make it visible.
      s.combo > 2 ? el("span", { class: `combo combo-${comboTier(s.combo)}` },
        "🔥", String(s.combo)) : null,
    ),
    exerciseView(ex),
    state.feedback ? null : hintBar(ex),
    state.feedback ? null : actionBar(ex),
    state.feedback ? feedbackBar() : null,
  );
}

/** The hint ladder: one button that reveals successive clues, plus the clues already shown. */
function hintBar(ex) {
  const remaining = state.hints.filter((h) => !state.shownHints.includes(h.step));
  if (state.hints.length === 0 && !state.shownHints.length) return null;
  const next = remaining[0];
  const shown = state.hints.filter((h) => state.shownHints.includes(h.step));

  return el("div", { class: "hint-area" },
    ...shown.map((h) => el("div", { class: "hint-shown" },
      el("span", { class: "hint-bulb", text: "💡" }),
      el("span", { class: "grow", text: hintTextFor(h.step) }),
    )),
    next
      ? el("button", {
          class: "btn btn-ghost hint-btn",
          onclick: revealHint,
        }, next.costsAttempt ? "💡 Show the answer" : `💡 ${next.label}`)
      : null,
  );
}

/** Looks up the wording of a revealed step from the loaded ladder. */
function hintTextFor(step) {
  return state.hintText?.[step] ?? "";
}

/** Small setup that must run after the DOM exists (autoplay, focus). */
function afterRenderForExercise(ex) {
  if (!ex) return;
  if (ex.type === "listen_select" || ex.type === "listen_type" || ex.type === "identify_character") {
    audio.speak(ex.audio?.text ?? ex.answer, ex.audio?.lang, 0.85);
  }
  if (ex.type === "speak") audio.speak(ex.answer ?? ex.prompt, ex.tts, 0.8);
  const input = document.querySelector(".text-input");
  if (input && (ex.type === "translate" || ex.type === "listen_type")) input.focus();
}

function exerciseView(ex) {
  const head = el("div", { class: "q-prompt" });
  if (ex.type === "listen_select" || ex.type === "listen_type" || ex.type === "identify_character") {
    head.append(el("button", {
      class: "speak-btn",
      onclick: (e) => { audio.speak(ex.audio.text, ex.audio.lang, 0.8); e.currentTarget.classList.add("speaking");
                        setTimeout(() => e.currentTarget.classList.remove("speaking"), 900); },
    }, "🔊"));
  }
  head.append(el("div", { class: "grow" },
    el("div", { class: "small muted", text: ex.directions }),
    ex.prompt ? el("div", { class: "q-text", text: ex.prompt }) : null,
  ));

  const body = el("div", {});
  switch (ex.type) {
    case "select_translation":
    case "listen_select":
    case "identify_character":
      body.append(choiceGrid(ex));
      break;
    case "select_image":
      body.append(imageGrid(ex));
      break;
    case "translate":
    case "listen_type":
      body.append(textAnswerInput(ex));
      break;
    case "word_bank":
    case "order_words":
      body.append(wordBank(ex));
      break;
    case "fill_blank":
      body.append(fillBlank(ex));
      break;
    case "match_pairs":
      body.append(matchPairs(ex));
      break;
    case "speak":
      body.append(speakView(ex));
      break;
    default:
      body.append(el("p", { class: "muted", text: `Unsupported exercise: ${ex.type}` }));
  }
  return el("div", {}, head, body);
}

function choiceGrid(ex) {
  return el("div", { class: "choices" },
    ...ex.choices.map((c) => el("button", {
      class: `choice ${state.answer === c ? "selected" : ""}` +
             (state.feedback && state.feedback.expected === c ? " correct" : "") +
             (state.feedback && !state.feedback.correct && state.answer === c ? " wrong" : ""),
      disabled: !!state.feedback,
      onclick: () => { state.answer = c; play("tap"); render(); },
    }, c)));
}

function imageGrid(ex) {
  return el("div", { class: "choices" },
    ...ex.choices.map((c) => el("button", {
      class: `choice image-choice ${state.answer === c.emoji ? "selected" : ""}` +
             // Correctness now comes from the server's verdict, not a leaked flag.
             (state.feedback && state.feedback.correct && state.answer === c.emoji ? " correct" : "") +
             (state.feedback && !state.feedback.correct && state.answer === c.emoji ? " wrong" : "") +
             (state.feedback && !state.feedback.correct && state.feedback.expected === c.emoji ? " correct" : ""),
      disabled: !!state.feedback,
      onclick: () => { state.answer = c.emoji; render(); },
    },
      el("span", { class: "emoji", text: c.emoji }),
      el("span", { class: "small muted", text: c.label }),
    )));
}

function textAnswerInput(ex) {
  const input = el("input", {
    class: "text-input",
    placeholder: "Type your answer…",
    value: state.answer ?? "",
    autocapitalize: "off",
    autocomplete: "off",
    spellcheck: "false",
    oninput: (e) => { state.answer = e.target.value; refreshActionBar(); },
    onkeydown: (e) => { if (e.key === "Enter") submitAnswer(); },
  });
  return el("div", {},
    input,
    el("p", { class: "small muted", style: "margin-top:8px" },
      "Tip: spelling and accents are checked. Press ", el("span", { class: "kbd", text: "Enter" }), " to check."),
  );
}

function wordBank(ex) {
  const used = new Set(state.answer.map((t) => t.index));
  const line = el("div", { class: "answer-line" },
    ...state.answer.map((tok, i) => el("button", {
      class: "token",
      disabled: !!state.feedback,
      onclick: () => { state.answer.splice(i, 1); play("tap"); render(); },
    }, tok.text)));
  const bank = el("div", { class: "bank" },
    ...ex.bank.map((word, i) => el("button", {
      class: `token ${used.has(i) ? "used" : ""}`,
      disabled: !!state.feedback,
      onclick: () => { state.answer.push({ text: word, index: i }); play("place"); render(); },
    }, word)));
  return el("div", {}, line, bank);
}

function fillBlank(ex) {
  const parts = String(ex.sentence).split("___");
  return el("div", {},
    el("div", { class: "sentence" },
      parts[0], el("span", { class: "blank" }), parts[1] ?? ""),
    choiceGrid(ex),
  );
}

function matchPairs(ex) {
  const a = state.answer;
  const leftDone = new Set(a.matched.map((m) => m.id));
  const wrongIds = a.wrongFlash ?? [];

  const makeItem = (side, item) => el("button", {
    class: "pair-item" +
      (a[side === "left" ? "selectedLeft" : "selectedRight"] === item.id ? " selected" : "") +
      (leftDone.has(item.id) ? " matched" : "") +
      (wrongIds.includes(item.id) ? " wrong" : ""),
    onclick: () => pickPair(side, item),
  }, item.text);

  return el("div", { class: "pairs" },
    el("div", { class: "pair-col" }, ...ex.left.map((i) => makeItem("left", i))),
    el("div", { class: "pair-col" }, ...ex.right.map((i) => makeItem("right", i))),
  );
}

function pickPair(side, item) {
  const a = state.answer;
  if (state.feedback) return;
  if (a.matched.some((m) => m.id === item.id)) return;
  if (side === "left") a.selectedLeft = item.id;
  else a.selectedRight = item.id;

  if (a.selectedLeft !== null && a.selectedRight !== null) {
    const ok = a.selectedLeft === a.selectedRight;
    a.attempts.push({ id: a.selectedLeft, correct: ok });
    if (ok) {
      a.matched.push({ id: a.selectedLeft });
      a.selectedLeft = null;
      a.selectedRight = null;
      play("match");
      // Board complete: submit automatically, like the real thing.
      if (a.matched.length >= state.session.exercise.pairs.length) {
        setTimeout(() => submitAnswer(), 220);
      }
    } else {
      a.wrongFlash = [a.selectedLeft, a.selectedRight];
      play("wrong");
      setTimeout(() => {
        a.wrongFlash = [];
        a.selectedLeft = null;
        a.selectedRight = null;
        render();
      }, 420);
    }
  }
  render();
}

function speakView(ex) {
  const said = state.answer?.transcript;
  return el("div", { class: "col" },
    el("button", {
      class: "btn btn-blue",
      onclick: async (e) => {
        const btn = e.currentTarget;
        btn.textContent = "🎤 Listening…";
        listenOnce(ex.tts, (transcript) => {
          state.answer = { transcript };
          render();
        }, (err) => {
          if (err === "no_support") {
            toast("This browser cannot listen — type the sentence instead", "warn");
            state.answer = { transcript: "" };
            render();
          } else if (err === "not-allowed") {
            toast("Microphone permission denied", "warn");
          } else {
            toast("Didn't catch that — try again", "warn");
          }
          btn.textContent = "🎤 Speak";
        });
      },
    }, "🎤 Speak"),
    said ? el("div", { class: "card tight" },
      el("div", { class: "small muted", text: "WE HEARD" }),
      el("div", { class: "bold", text: said })) : null,
    said === "" || !said
      ? el("div", {},
          el("input", {
            class: "text-input",
            placeholder: "…or type what you would say",
            oninput: (ev) => { state.answer = { transcript: ev.target.value }; refreshActionBar(); },
            onkeydown: (ev) => { if (ev.key === "Enter") submitAnswer(); },
          }))
      : null,
    el("button", { class: "btn btn-ghost", onclick: () => audio.speak(ex.answer ?? ex.prompt, ex.tts, 0.8) },
      "🔊 Hear it again"),
  );
}

function actionBar(ex) {
  const ready = answerIsReady(ex);
  const label = ex.type === "word_bank" || ex.type === "order_words" ? "Check" : "Check";
  return el("div", { class: "row", style: "margin-top:18px;gap:10px" },
    el("button", { class: "btn btn-ghost", onclick: () => skipExercise(ex) }, "Skip"),
    el("button", {
      class: "btn btn-primary grow", disabled: !ready,
      onclick: submitAnswer,
    }, label),
  );
}

function refreshActionBar() {
  // Cheap partial update: only the button's disabled state changes while typing.
  const btn = document.querySelector(".lesson-screen .btn-primary") ?? document.querySelector(".btn-primary.grow");
  if (btn && state.session?.exercise) btn.disabled = !answerIsReady(state.session.exercise);
}

function answerIsReady(ex) {
  const a = state.answer;
  switch (ex.type) {
    case "word_bank":
    case "order_words": return Array.isArray(a) && a.length > 0;
    case "match_pairs": return Array.isArray(a.matched) && a.matched.length >= ex.pairs.length;
    case "speak": return typeof a?.transcript === "string" && a.transcript.trim().length > 0;
    default: return typeof a === "string" && a.trim().length > 0;
  }
}

function skipExercise(ex) {
  // Skipping counts as a wrong answer, exactly like the real product.
  state.answer = "__skipped__";
  submitAnswer();
}

function feedbackBar() {
  const f = state.feedback;
  const isLast = f.finished;
  const nearMiss = f.correct && f.mistake;   // forgiven: worth pointing out what slipped
  return el("div", { class: `feedback ${f.correct ? "correct" : "wrong"}` },
    el("div", { class: "inner" },
      el("div", { class: "row-between" },
        el("div", { style: "flex:1" },
          el("h3", {}, f.correct ? "✅ " : "❌ ", f.correct ? (nearMiss ? "Close enough!" : pickPraise()) : "Not quite"),
          el("div", { class: "small", text: f.feedback }),
          f.expected && !f.correct
            ? el("div", { class: "small", style: "margin-top:4px" },
                "Correct answer: ", el("strong", { text: f.expected }))
            : null,
          // Show word-by-word where it went wrong — much more useful than a bare "wrong".
          f.diff && !f.correct ? wordDiff(f.diff) : null,
        ),
        el("button", {
          class: `btn ${f.correct ? "btn-primary" : "btn-danger"}`,
          onclick: nextExercise,
        }, isLast ? "See results" : "Continue"),
      ),
    ),
  );
}

/** Renders the word-level diff: right words dimmed, wrong ones struck through, extras marked. */
function wordDiff(diff) {
  const parts = [];
  for (const d of diff) {
    if (d.status === "ok") continue;                 // no need to show what was right
    const label = d.status === "missing" ? d.expected : (d.given ?? d.expected);
    if (!label) continue;
    parts.push(el("span", { class: d.status, text: label }));
  }
  if (parts.length === 0) return null;
  return el("div", { class: "diff-words" }, ...parts);
}

let praiseIndex = 0;
function pickPraise() {
  return ["Nice!", "Exactly right!", "Well done!", "Perfect!", "You've got it!"][praiseIndex++ % 5];
}

async function submitAnswer() {
  const s = state.session;
  if (!s || state.busy || !answerIsReady(s.exercise)) return;
  // Guard against a double submit: the same exercise must never be graded twice.
  if (state.inFlight === s.exercise.id) return;
  state.inFlight = s.exercise.id;
  try {
    state.busy = true;
    let answer = state.answer;
    if (s.exercise.type === "word_bank" || s.exercise.type === "order_words") {
      answer = state.answer.map((t) => t.text);
    }
    if (s.exercise.type === "match_pairs") {
      answer = state.answer.attempts;
    }
    const res = await API.post(`/api/lessons/${s.sessionId}/answer`, {
      exerciseId: s.exercise.id, answer, ms: 1000, clientDay: state.day,
    });

    if (res.resync) {
      // The server had already graded this exercise, so there is no feedback to show — the
      // pending exercise in the payload is simply the current one. Adopt it and carry on.
      state.session = { ...s, exercise: res.next, index: res.index, total: res.total, hearts: res.hearts };
      state.pendingNext = null;
      state.feedback = null;
      state.answer = emptyAnswer(res.next);
      render();
      afterRenderForExercise(res.next);
      return;
    }

    // IMPORTANT: keep showing the exercise that was just answered while the feedback bar is up.
    // Adopting `res.next` here rendered the following question behind the bar, before the user
    // had even pressed Continue — and made the progress bar and "n / total" jump ahead one
    // question. The next exercise is held in `pendingNext` and only promoted by nextExercise().
    state.session = { ...s, hearts: res.hearts };
    state.pendingNext = res.next
      ? { exercise: res.next, index: res.index, total: res.total }
      : null;
    state.feedback = { ...res.result, finished: res.finished, summary: res.summary };
    state.lastSummary = res.summary ?? state.lastSummary;
    // The pending answer belongs to the exercise that is coming next, so reset it to that
    // type's shape now — otherwise the next render draws against the old value and throws.
    if (res.next) state.answer = emptyAnswer(res.next);

    // Sound makes the difference between "I answered" and "that felt good".
    if (res.result.correct) {
      if (!state.hintSpent) play("correct", res.combo);
    } else {
      play("wrong");
    }

    render();

    // Load the next question's hints while the learner reads the feedback, so the hint button is
    // ready the moment they hit Continue.
    if (res.next) loadHints(res.next);
  } catch (err) {
    // Any unexpected desync: resynchronise the session rather than leaving the UI stuck.
    if (err.code === "out_of_sync" || err.code === "no_exercise") {
      await resyncSession(s.sessionId);
      return;
    }
    handleSessionError(err);
  } finally {
    state.busy = false;
    state.inFlight = null;
  }
}

/** Pulls the authoritative session state from the server after a desync. */
async function resyncSession(sessionId) {
  try {
    const next = await API.get(`/api/lessons/${sessionId}/exercise`);
    if (next.finished) {
      showResults(next.summary ?? state.lastSummary);
      return;
    }
    state.session = { ...state.session, exercise: next.exercise, index: next.index, total: next.total,
                      hearts: next.hearts };
    state.pendingNext = null;
    state.feedback = null;
    state.answer = emptyAnswer(next.exercise);
    render();
    afterRenderForExercise(next.exercise);
  } catch (e) {
    toast("Could not reload the lesson — starting fresh", "warn");
    state.session = null;
    state.screen = "learn";
    loadScreen();
  }
}

function nextExercise() {
  if (state.feedback?.finished) return showResults(state.feedback.summary ?? state.lastSummary);
  state.feedback = null;
  // Promote the exercise the server handed us when this one was graded. Only now does the
  // question on screen change — pressing Continue is what advances the lesson.
  if (state.pendingNext) {
    state.session = {
      ...state.session,
      exercise: state.pendingNext.exercise,
      index: state.pendingNext.index,
      total: state.pendingNext.total,
    };
    state.pendingNext = null;
  }
  // The next exercise is a different type, so the pending answer must match its shape.
  state.answer = emptyAnswer(state.session.exercise);
  state.hintText = {};
  render();
  afterRenderForExercise(state.session.exercise);
  loadHints(state.session.exercise);
}

function showResults(summary) {
  state.session = null;
  state.pendingNext = null;
  state.hints = [];
  state.shownHints = [];
  state.hintText = {};
  state.hintSpent = false;
  state.feedback = null;
  if (!summary) { state.screen = "learn"; return loadScreen(); }

  // Celebration scales with the result: perfect > passed > out of hearts.
  if (summary.passed && summary.mistakes === 0) play("perfect");
  else if (summary.passed) play("complete");
  else if (summary.outOfHearts) play("fail");

  const bits = [];
  if (summary.passed) {
    bits.push(`+${summary.xp} XP`, `${summary.accuracy}% correct`);
    if (summary.streakIncreased) bits.push(`🔥 ${summary.streak} day streak`);
  } else {
    bits.push(`You answered ${summary.correct} of ${summary.answered} correctly.`);
    bits.push("Practice is free — give it another go.");
  }
  if (summary.skillUp?.unlocked) bits.push(`Unlocked ${summary.skillUp.unlocked.title}!`);

  showDialog({
    emoji: summary.passed ? (summary.mistakes === 0 ? "🏆" : "🎉") : summary.outOfHearts ? "💔" : "😅",
    title: summary.passed
      ? (summary.mistakes === 0 ? "Flawless!" : "Lesson complete!")
      : summary.outOfHearts ? "Out of hearts" : "Not quite",
    body: bits.join(" · "),
    extra: el("div", { class: "col", style: "margin-top:12px;align-items:center" },
      summary.achievements?.length
        ? el("div", { class: "col", style: "align-items:center" },
            ...summary.achievements.map((a) => el("div", { class: "pill gold" }, "🏅", a.label, " unlocked!")))
        : null,
      summary.skillUp && summary.skillUp.level ? el("div", { class: "pill blue" },
        "⛰️", `Level ${summary.skillUp.level} of ${summary.skillUp.maxLevel}`) : null,
    ),
    actions: [{ label: "Continue", kind: "primary", onclick: () => { closeDialog(); state.screen = "learn"; loadScreen(); } }],
  });
}

function confirmQuit() {
  showDialog({
    emoji: "🚪",
    title: "Quit this session?",
    body: "Your progress in this session is lost. Mistakes already cost hearts.",
    actions: [
      { label: "Quit", kind: "danger", onclick: () => { closeDialog(); state.session = null; state.screen = "learn"; loadScreen(); } },
      { label: "Keep practising", kind: "ghost", onclick: closeDialog },
    ],
  });
}

// --------------------------------------------------------------------- story

function storyScreen() {
  const s = state.session;
  const story = s?.exercise;
  if (!story) return el("div", { class: "spinner" });
  const st = state.story;
  const pct = ((st.page + 1) / (story.lines.length + 1)) * 100;

  const progress = el("div", { class: "lesson-top" },
    el("button", { class: "btn btn-ghost", style: "padding:8px 12px", onclick: confirmQuit }, "✕"),
    el("div", { class: "progress-track" }, el("div", { class: "progress-fill", style: `width:${pct}%` })),
  );

  // Page N: the dialogue line N. Last page: the comprehension questions.
  if (st.page < story.lines.length) {
    const line = story.lines[st.page];
    const shown = story.lines.slice(0, st.page + 1);
    return el("div", { class: "screen" }, progress,
      el("h2", {}, story.title, el("span", { class: "small muted", style: "font-weight:400" }, " — ", story.titleEn)),
      ...shown.map((l, i) => el("div", { class: `story-line ${i % 2 ? "alt" : ""}` },
        el("div", { class: "story-avatar", text: l.speaker[0] }),
        el("div", { class: "story-bubble" },
          el("div", { class: "speaker", text: l.speaker }),
          el("div", { class: "said", text: l.text }),
          el("div", { class: "trans", text: l.en }),
        ),
      )),
      el("div", { class: "row", style: "gap:10px;margin-top:14px" },
        el("button", { class: "btn btn-ghost", onclick: () => audio.speak(line.text, state.currentCourse.tts, 0.85) }, "🔊"),
        el("button", { class: "btn btn-primary grow", onclick: () => { st.page++; render(); } }, "Continue"),
      ),
    );
  }

  const allAnswered = story.questions.every((q) => st.answers[q.id]);
  return el("div", { class: "screen" }, progress,
    el("h2", { text: "Comprehension" }),
    ...story.questions.map((q) => el("div", { class: "card", style: "margin-bottom:12px" },
      el("div", { class: "bold", style: "margin-bottom:8px", text: q.q }),
      el("div", { class: "choices" },
        ...q.choices.map((c) => el("button", {
          class: `choice ${st.answers[q.id] === c ? "selected" : ""}`,
          disabled: st.revealed,
          onclick: () => { st.answers[q.id] = c; render(); },
        }, c))),
    )),
    el("button", {
      class: "btn btn-primary btn-wide", disabled: !allAnswered,
      onclick: async () => {
        try {
          state.busy = true;
          const res = await API.post(`/api/lessons/${s.sessionId}/answer`, {
            exerciseId: story.id, answer: st.answers, clientDay: state.day,
          });
          showResults(res.summary);
        } catch (e) { handleSessionError(e); } finally { state.busy = false; }
      },
    }, "Check answers"),
  );
}

// --------------------------------------------------------------------- profile

function profileScreen() {
  const u = state.user;
  const courses = state.meta?.courses ?? [];
  return shell(el("div", {},
    el("div", { class: "card" },
      el("div", { class: "row" },
        el("div", { class: "lb-avatar", style: "width:60px;height:60px;font-size:30px", text: "🦜" }),
        el("div", { class: "grow" },
          el("div", { class: "bold", style: "font-size:20px", text: u.displayName }),
          el("div", { class: "small muted", text: "@" + u.username }),
        ),
      ),
    ),

    el("div", { class: "row", style: "gap:10px;margin-top:12px" },
      statCard("🔥", u.streak, u.streak === 1 ? "day streak" : "day streak"),
      statCard("⚡", u.xp, "total XP"),
      statCard("💎", u.gems, "gems"),
      statCard("👑", state.currentCourse?.crowns ?? 0, "crowns"),
    ),

    el("h2", { text: "Achievements" }),
    el("div", { class: "card" },
      ...(state.achievements ?? []).map((a) => el("div", { class: `achievement ${a.unlocked ? "" : "locked"}` },
        el("div", { class: "amedal", text: a.unlocked ? "🏅" : "🔒" }),
        el("div", {},
          el("div", { class: "bold", text: a.label }),
          el("div", { class: "small muted", text: a.hint }),
        ),
      )),
    ),

    el("h2", { text: "Settings" }),
    el("div", { class: "card col" },
      settingRow("Daily goal (XP)", el("input", {
        class: "text-input", type: "number", min: 10, max: 200, value: u.dailyGoal,
        style: "width:110px",
        onchange: async (e) => { await saveSettings({ dailyGoal: Number(e.target.value) }); },
      })),
      settingRow("Sound", toggle(u.soundEnabled, (v) => { saveSettings({ soundEnabled: v }); if (v) play("reward"); })),
      settingRow("Sound effects", toggle(Sound.enabled, (v) => {
        Sound.setEnabled(v);
        localStorage.setItem("parroto.sfx", v ? "1" : "0");
        render();
        if (v) play("correct", 3);
      })),
      settingRow("Speaking exercises", toggle(u.speakingEnabled, (v) => saveSettings({ speakingEnabled: v }))),
      settingRow("Show me on the leaderboard", toggle(u.leaderboardOptin, (v) => saveSettings({ leaderboardOptin: v }))),
    ),

    el("h2", { text: "Courses" }),
    el("p", { class: "small muted", text: "Tap a course to switch. Progress is kept for each one." }),
    el("div", { class: "card" },
      ...courses.map((c) => {
        const mine = state.myCourses?.find((m) => m.id === c.id);
        const isCurrent = state.currentCourse?.id === c.id;
        return el("button", {
          class: "course-pick", style: `margin-bottom:6px;${isCurrent ? "border-color:var(--green)" : ""}`,
          onclick: async () => {
            try {
              await API.post(`/api/courses/${c.id}/switch`);
              await boot();          // re-reads home, so the path below changes to this course
              toast(`Now learning ${c.name}`, "good");
            } catch (e) { toast(e.message, "warn"); }
          },
        },
          el("span", { class: "flag", text: c.flag }),
          el("span", { class: "grow" },
            el("div", { class: "bold", text: c.name }),
            el("div", { class: "small muted" },
              mine ? `${mine.crowns} crowns · ${mine.xp} XP` : "Not started"),
          ),
          isCurrent ? el("span", { class: "pill green", text: "learning" })
                    : el("span", { class: "pill", text: "switch" }),
        );
      }),
    ),

    el("div", { class: "row", style: "gap:10px;margin-top:16px" },
      el("button", { class: "btn btn-ghost grow", onclick: buyFreeze }, `Buy streak freeze (200 💎)`),
      el("button", {
        class: "btn btn-danger",
        onclick: async () => { await API.post("/api/logout"); API.setToken(null); location.reload(); },
      }, "Sign out"),
    ),
    el("p", { class: "small muted center", style: "margin-top:20px" },
      "Parroto · learn a language by parroting it back"),
  ));
}

/** A quick course switcher, so changing language does not require a trip to Profile. */
function switchCourseDialog() {
  const enrolled = state.myCourses ?? [];
  const all = state.meta?.courses ?? enrolled;
  const list = all.length ? all : enrolled;
  showDialog({
    emoji: "🌍",
    title: "Switch course",
    body: "Pick the language you want to learn. Each course keeps its own progress.",
    extra: el("div", { class: "col", style: "margin-top:14px;text-align:left" },
      ...list.map((c) => {
        const mine = enrolled.find((m) => m.id === c.id);
        const isCurrent = state.currentCourse?.id === c.id;
        return el("button", {
          class: "course-pick", style: "margin-bottom:6px",
          disabled: isCurrent,
          onclick: async () => {
            try {
              closeDialog();
              await API.post(`/api/courses/${c.id}/switch`);
              await boot();
              toast(`Now learning ${c.name}`, "good");
            } catch (e) { toast(e.message, "warn"); }
          },
        },
          el("span", { class: "flag", text: c.flag }),
          el("span", { class: "grow" },
            el("div", { class: "bold", text: c.name }),
            el("div", { class: "small muted" },
              mine ? `${mine.crowns} crowns · ${mine.xp} XP` : "Not started"),
          ),
          isCurrent ? el("span", { class: "pill green", text: "learning" }) : null,
        );
      }),
    ),
    actions: [{ label: "Close", kind: "ghost", onclick: closeDialog }],
  });
}

function statCard(icon, value, label) {
  return el("div", { class: "card tight grow center" },
    el("div", { style: "font-size:22px", text: icon }),
    el("div", { class: "bold", style: "font-size:19px", text: String(value) }),
    el("div", { class: "small muted", text: label }),
  );
}

function settingRow(label, control) {
  return el("div", { class: "row-between", style: "padding:6px 0" },
    el("span", { class: "bold", text: label }), control);
}

function toggle(on, onChange) {
  return el("button", {
    class: "btn",
    style: `padding:6px 14px;text-transform:none;letter-spacing:0;background:${on ? "var(--green)" : "var(--line)"};color:${on ? "#fff" : "var(--muted)"}`,
    onclick: () => onChange(!on),
  }, on ? "On" : "Off");
}

async function saveSettings(patch) {
  try {
    const res = await API.patch("/api/me", patch);
    state.user = res.user;
    render();
    toast("Saved", "good");
  } catch (e) { toast(e.message, "warn"); }
}

async function buyFreeze() {
  try { await API.post("/api/shop/streak-freeze"); await loadScreen(); toast("Streak freeze bought", "good"); }
  catch (e) { toast(e.message, "warn"); }
}

// --------------------------------------------------------------------- league

function leaderboardScreen() {
  const lb = state.leaderboard;
  if (!lb) return shell(el("div", { class: "spinner" }));
  const medals = ["🥇", "🥈", "🥉"];
  return shell(el("div", {},
    el("h1", { text: "League" }),
    el("p", { class: "muted", small: true },
      `Week ${lb.week} · top 3 promote, bottom 3 demote`),
    el("div", { class: "card", style: "margin-top:12px" },
      ...lb.entries.map((e) => el("div", { class: `lb-row ${e.isYou ? "you" : ""}` },
        el("span", { class: "lb-rank", text: medals[e.rank - 1] ?? String(e.rank) }),
        el("span", { class: "lb-avatar", text: "🦜" }),
        el("span", { class: "grow bold", text: e.displayName }),
        el("span", { class: "muted small" }, `${e.xp} XP`),
      )),
    ),
    lb.outcome !== "stay"
      ? el("p", { class: "center", style: "margin-top:12px" },
          lb.outcome === "promote" ? "🎉 You're on track to promote!" : "⚠️ You're in the demotion zone.")
      : null,
  ));
}

// --------------------------------------------------------------------- quests

function questsScreen() {
  return shell(el("div", {},
    el("h1", { text: "Daily quests" }),
    el("p", { class: "muted", text: "Three fresh quests every day. Finish them for gems." }),
    el("div", { class: "card", style: "margin-top:12px" },
      ...(state.quests ?? []).map((q) => el("div", { class: "quest" },
        el("span", { class: "qicon", text: q.done ? "✅" : "⭕" }),
        el("div", { class: "grow" },
          el("div", { class: "bold", text: q.label }),
          el("div", { class: "progress-track", style: "margin-top:6px" },
            el("div", { class: "progress-fill", style: `width:${(q.progress / q.goal) * 100}%` })),
          el("div", { class: "small muted", style: "margin-top:3px" }, `${q.progress} / ${q.goal}`),
        ),
        q.done && !q.claimed
          ? el("button", {
              class: "btn btn-primary", style: "padding:8px 14px;font-size:13px",
              onclick: async () => {
                try {
                  const r = await API.post(`/api/quests/${q.id}/claim?day=${state.day}`);
                  await loadScreen();
                  toast(`+${r.gems} gems`, "good");
                } catch (e) { toast(e.message, "warn"); }
              },
            }, "+20 💎")
          : q.claimed ? el("span", { class: "pill green", text: "Claimed" }) : null,
      )),
    ),
    el("h2", { text: "Practice more" }),
    el("div", { class: "card" },
      el("p", { class: "small muted", text: "Extra practice sessions never cost hearts." }),
      el("button", {
        class: "btn btn-blue btn-wide",
        onclick: () => startSession({ kind: "review" }),
      }, `Review ${state.home?.dueCount ?? 0} due words`),
    ),
  ));
}

// --------------------------------------------------------------------- dialogs

function showDialog({ emoji, title, body, extra, actions }) {
  closeDialog();
  const dlg = el("div", { class: "dialog" },
    emoji ? el("div", { class: "big-emoji", text: emoji }) : null,
    el("h2", { text: title }),
    el("p", { text: body }),
    extra ?? null,
    el("div", { class: "col", style: "margin-top:18px" },
      ...(actions ?? []).map((a) => el("button", {
        class: `btn btn-${a.kind ?? "ghost"} btn-wide`, onclick: a.onclick,
      }, a.label)),
    ),
  );
  const backdrop = el("div", { class: "dialog-backdrop", id: "dialog" }, dlg);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeDialog(); });
  document.body.append(backdrop);
}

function closeDialog() {
  document.getElementById("dialog")?.remove();
}

// --------------------------------------------------------------------- screens & boot

async function loadScreen() {
  try {
    if (state.screen === "learn") {
      const [home, myCourses] = await Promise.all([API.get("/api/home"), API.get("/api/courses")]);
      state.home = home;
      state.meta = state.meta ?? { courses: myCourses.courses };
      state.myCourses = home.courses;
      state.user = home.user;
      state.currentCourse = home.currentCourse;
      if (!state.currentCourse) { state.screen = "courses"; return render(); }
      state.dueCount = home.dueCount;
      state.quests = home.quests;
      return render();
    }
    if (state.screen === "courses") {
      state.meta = await API.get("/api/meta");
      return render();
    }
    if (state.screen === "profile") {
      const [stats, meta] = await Promise.all([API.get("/api/stats"), API.get("/api/meta")]);
      state.user = stats.user;
      state.achievements = stats.achievements;
      state.myCourses = stats.courses;
      state.meta = meta;
      return render();
    }
    if (state.screen === "leaderboard") {
      state.leaderboard = await API.get("/api/leaderboard");
      return render();
    }
    if (state.screen === "quests") {
      const [q, home] = await Promise.all([
        API.get(`/api/quests?day=${state.day}`), API.get("/api/home"),
      ]);
      state.quests = q.quests;
      state.home = home;
      state.user = home.user;
      state.currentCourse = home.currentCourse;
      return render();
    }
    render();
  } catch (err) {
    if (err.status === 401) { API.setToken(null); state.user = null; state.screen = "auth"; return render(); }
    toast(err.message, "warn");
    render();
  }
}

async function boot() {
  try {
    const home = await API.get("/api/home");
    state.user = home.user;
    state.home = home;
    state.myCourses = home.courses;
    state.currentCourse = home.currentCourse;
    state.quests = home.quests;
    state.dueCount = home.dueCount;
    if (!home.currentCourse) {
      state.screen = "courses";
      state.meta = await API.get("/api/meta");
      return render();
    }
    state.screen = "learn";
    render();
  } catch (err) {
    if (err.status === 401) { state.screen = "auth"; return render(); }
    toast(err.message, "warn");
    state.screen = "auth";
    render();
  }
}

// Keyboard shortcuts: 1-9 select a choice, Enter continues.
window.addEventListener("keydown", (e) => {
  if (state.screen !== "lesson" || state.busy) return;
  if (e.key === "Enter" && state.feedback) { e.preventDefault(); return nextExercise(); }
  const n = Number(e.key);
  const ex = state.session?.exercise;
  if (!ex || state.feedback || !Number.isInteger(n) || n < 1) return;
  if (ex.choices && ex.choices[n - 1] !== undefined) {
    const choice = ex.choices[n - 1];
    state.answer = typeof choice === "object" ? choice.emoji : choice;
    render();
  }
  if (ex.bank && ex.bank[n - 1] !== undefined) {
    state.answer.push({ text: ex.bank[n - 1], index: n - 1 });
    render();
  }
});

// Restore the client-side sound preference before anything renders.
if (localStorage.getItem("parroto.sfx") === "0") Sound.setEnabled(false);

// Sound needs a user gesture before the browser will play anything. Unlock on the first
// interaction of any kind, then forget about it.
for (const ev of ["pointerdown", "keydown", "touchstart"]) {
  window.addEventListener(ev, () => Sound.unlock(), { once: true, passive: true });
}

// Speech voices load asynchronously in most browsers; warm them up early.
if ("speechSynthesis" in window) window.speechSynthesis.getVoices();

// A small debug surface. Handy when driving the app from a browser automation tool, and
// harmless in production since it only exposes what the page already holds in memory.
window.__parroto = { state, API, render, loadScreen, submitAnswer, nextExercise };

if (API.token) boot(); else { state.screen = "auth"; render(); }
