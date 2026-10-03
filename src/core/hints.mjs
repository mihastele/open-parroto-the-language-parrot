/**
 * Parroto — help that teaches.
 *
 * Rather than an "I don't know" button that just reveals the answer, each exercise exposes a
 * ladder of progressively larger clues. The first step nudges, the last one shows the answer —
 * so a learner who is stuck can keep making progress without the answer being the first option.
 *
 * Pure functions on an exercise object; no I/O, so this is cheap to test exhaustively.
 */

/** The types where a hint ladder is meaningful. */
const HINTABLE = new Set([
  "translate", "listen_type", "word_bank", "order_words", "fill_blank",
  "select_translation", "select_image", "listen_select", "identify_character", "speak",
  "match_pairs",
]);

export function isHintable(exercise) {
  return HINTABLE.has(exercise?.type);
}

/**
 * Builds the hint ladder for an exercise. Each entry:
 *   { kind, label, text, reveals? }
 * `reveals: true` on the last rung means it gives the answer away (which costs the attempt).
 */
export function hintsFor(exercise) {
  if (!isHintable(exercise)) return [];

  // match_pairs has no single answer — its hints are pair pointers, not a reveal of "the answer".
  if (exercise.type === "match_pairs") {
    const pairs = Array.isArray(exercise.pairs) ? exercise.pairs : [];
    if (pairs.length === 0) return [];
    const out = [];
    out.push({
      kind: "pair", label: "Show me one pair",
      text: `“${pairs[0].left}” matches “${pairs[0].right}”.`,
      reveals: true, costsAttempt: false,
    });
    if (pairs.length >= 2) {
      out.push({
        kind: "pair", label: "Show me another pair",
        text: `“${pairs[1].left}” matches “${pairs[1].right}”.`,
        reveals: true, costsAttempt: false,
      });
    }
    return out.map((h, i) => ({ ...h, step: i + 1 }));
  }

  const answer = answerText(exercise);
  // No answer means no ladder. Without this guard, a malformed exercise produced a nonsense
  // hint ("The answer has 0 words.") and a revealing rung with empty text.
  if (!answer || answer.trim().length === 0) return [];
  const hints = [];

  switch (exercise.type) {
    case "translate": {
      // 1. What kind of word starts each part.
      hints.push({
        kind: "structure",
        label: "Show the shape",
        text: `The answer has ${countWords(answer)} word${countWords(answer) === 1 ? "" : "s"}.`,
      });
      // 2. The article/gender, if the target starts with one.
      const article = answer.match(/^(el|la|los|las|le|la|les|der|die|das|il|lo|gli|i|l['’])\s?/i);
      if (article) {
        hints.push({
          kind: "article",
          label: "Show the article",
          text: `It starts with “${article[1].trim()}”.`,
        });
      }
      // 3. First letter of every word.
      hints.push({
        kind: "initials",
        label: "Show first letters",
        text: answer.split(" ").map((w) => w[0] ?? "").join(" ") + " …",
      });
      break;
    }

    case "word_bank":
    case "order_words": {
      const order = tokensOfExercise(exercise);
      hints.push({
        kind: "count",
        label: "How many words?",
        text: `Use ${order.length} tiles.`,
      });
      hints.push({
        kind: "first",
        label: "Show the first word",
        text: `It starts with “${order[0] ?? ""}”.`,
      });
      hints.push({
        kind: "order",
        label: "Show the order",
        // Plain words, not "a → b": the revealing rung must be text the grader accepts.
        text: order.join(" "),
        reveals: true,
        costsAttempt: true,
      });
      break;
    }

    case "fill_blank": {
      hints.push({
        kind: "length",
        label: "How long is it?",
        text: `The missing word has ${String(answer).length} letters.`,
      });
      hints.push({
        kind: "first",
        label: "Show the first letter",
        text: `It begins with “${String(answer)[0] ?? ""}”.`,
      });
      break;
    }

    case "select_translation":
    case "select_image":
    case "listen_select": {
      // Eliminate wrong options instead of revealing the right one.
      const wrong = choicesOf(exercise).filter((c) => !isCorrectChoice(c, exercise));
      if (wrong.length) {
        hints.push({
          kind: "eliminate",
          label: "Remove a wrong answer",
          text: `“${labelOf(wrong[0])}” is not it.`,
        });
      }
      if (wrong.length > 1) {
        hints.push({
          kind: "eliminate",
          label: "Remove another",
          text: `“${labelOf(wrong[1])}” is not it either.`,
        });
      }
      break;
    }

    case "identify_character": {
      hints.push({
        kind: "clue",
        label: "Give me a clue",
        text: "Listen again — it is in the first half of the word it appears in.",
      });
      break;
    }

    case "listen_type": {
      hints.push({
        kind: "count",
        label: "How many words?",
        text: `You heard ${countWords(answer)} word${countWords(answer) === 1 ? "" : "s"}.`,
      });
      hints.push({
        kind: "initials",
        label: "Show first letters",
        text: answer.split(" ").map((w) => w[0] ?? "").join(" ") + " …",
      });
      break;
    }

    case "speak": {
      hints.push({
        kind: "translate",
        label: "What am I saying?",
        text: exercise.prompt ? `You are saying: “${exercise.prompt}”.` : "Say the phrase clearly.",
      });
      hints.push({
        kind: "slow",
        label: "Hear it slowly",
        text: "Play the audio at half speed, then try again.",
        action: "play_slow",
      });
      break;
    }

    case "match_pairs": {
      // Handled before the answer check — a match board has no single answer.
      break;
    }

    default:
      break;
  }

  // Always finish with the escape hatch, clearly marked as costing the attempt.
  if (hints.length < 4) {
    hints.push({
      kind: "answer",
      label: "Show the answer",
      text: answer,
      reveals: true,
      costsAttempt: true,
    });
  }
  return hints.map((h, i) => ({ ...h, step: i + 1 }));
}

// ---------------------------------------------------------------------- helpers

function answerText(exercise) {
  if (Array.isArray(exercise.answer)) return exercise.answer.join(" ");
  return String(exercise.answer ?? "");
}

function tokensOfExercise(exercise) {
  if (Array.isArray(exercise.answer)) return exercise.answer.map(String);
  return String(exercise.answer ?? "").split(/\s+/).filter(Boolean);
}

function countWords(s) {
  return String(s).split(/\s+/).filter(Boolean).length;
}

function choicesOf(exercise) {
  return Array.isArray(exercise.choices) ? exercise.choices : [];
}

function isCorrectChoice(choice, exercise) {
  const answer = Array.isArray(exercise.answer) ? exercise.answer : [exercise.answer];
  if (choice && typeof choice === "object") return !!choice.correct || answer.includes(choice.emoji);
  return answer.includes(choice);
}

function labelOf(choice) {
  if (choice && typeof choice === "object") return choice.label ?? choice.emoji ?? String(choice);
  return String(choice);
}

/**
 * Strips anything that gives the answer away, for sending to the client *before* the learner
 * asks for help. The client requests a single step by number; the server reveals only that one.
 */
export function hintPreview(exercise) {
  return hintsFor(exercise).map(({ kind, label, step, reveals, costsAttempt }) =>
    ({ kind, label, step, reveals: !!reveals, costsAttempt: !!costsAttempt }));
}

/** The text of one hint step. `reveals` tells the caller whether the attempt is now spent. */
export function hintStep(exercise, step) {
  const all = hintsFor(exercise);
  const found = all.find((h) => h.step === Number(step));
  return found ?? null;
}
