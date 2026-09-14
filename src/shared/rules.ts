import { QUESTIONS } from './questions';
import type {
  AnswerResult, Category, CategorySelection, Difficulty, MatchConfig,
  Player, PublicQuestion, Question,
} from './types';

export const ROUND_MS = 15_000;
export const REVEAL_MS = 4_000;
export const COUNTDOWN_MS = 3_000;

const CATEGORIES: readonly Category[] = ['general', 'puzzles', 'reasoning'];
const MAX_QUESTIONS = 15;
const BOT_SETTINGS: Record<Difficulty, { accuracy: number; minMs: number; maxMs: number }> = {
  easy: { accuracy: 0.55, minMs: 4_000, maxMs: 10_000 },
  medium: { accuracy: 0.75, minMs: 2_500, maxMs: 7_000 },
  hard: { accuracy: 0.9, minMs: 1_300, maxMs: 4_500 },
};

function isCategory(value: unknown): value is CategorySelection {
  return value === 'general' || value === 'puzzles' || value === 'reasoning' || value === 'mixed';
}

function isDifficulty(value: unknown): value is Difficulty {
  return value === 'easy' || value === 'medium' || value === 'hard';
}

function inAnswerWindow(elapsedMs: number): boolean {
  return Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs <= ROUND_MS;
}

// The injectable generator follows Math.random's [0, 1) contract.
function randomUnit(rng: () => number): number {
  const value = rng();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('Random generator must return a finite number in [0, 1).');
  }
  return value;
}

function shuffled<T>(values: readonly T[], rng: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(randomUnit(rng) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function shuffleOptions(question: Question, rng: () => number): Question {
  const order = shuffled([0, 1, 2, 3], rng);
  return {
    ...question,
    options: order.map((index) => question.options[index]) as Question['options'],
    correct: order.indexOf(question.correct),
  };
}

export function scoreAnswer(correct: boolean, elapsedMs: number): number {
  if (!correct || !inAnswerWindow(elapsedMs)) return 0;
  return 1_000 + Math.round(500 * (1 - elapsedMs / ROUND_MS));
}

/** Explicit allowlist: never send the answer key or explanation before reveal. */
export function publicQuestion(q: Question): PublicQuestion {
  return {
    id: q.id,
    category: q.category,
    difficulty: q.difficulty,
    prompt: q.prompt,
    options: [...q.options],
  };
}

/**
 * Select 0..15 unique questions, regardless of bot difficulty.
 * Mixed rounds differ by at most one question per category; extra slots are random.
 * Both the questions and their options are copied before shuffling.
 */
export function selectQuestions(
  category: CategorySelection,
  count: number,
  rng: () => number = Math.random,
): Question[] {
  if (!isCategory(category)) throw new RangeError('Invalid question category.');
  if (!Number.isInteger(count) || count < 0 || count > MAX_QUESTIONS) {
    throw new RangeError('Question count must be an integer from 0 to 15.');
  }
  if (count === 0) return [];

  let selected: Question[];
  if (category === 'mixed') {
    const categories = shuffled(CATEGORIES, rng);
    selected = categories.flatMap((current, index) => {
      const quota = Math.floor(count / categories.length) + (index < count % categories.length ? 1 : 0);
      return shuffled(QUESTIONS.filter((q) => q.category === current), rng).slice(0, quota);
    });
  } else {
    selected = shuffled(QUESTIONS.filter((q) => q.category === category), rng).slice(0, count);
  }
  return shuffled(selected, rng).map((q) => shuffleOptions(q, rng));
}

/**
 * Invalid indices are treated as unanswered, not coerced into option indices.
 * Unanswered/invalid-time results record a full timeout so totals stay finite.
 * Check the original time before normalizing: late answers must never gain points.
 */
export function makeAnswer(
  q: Question,
  playerId: string,
  choice: number | null,
  elapsedMs: number,
): AnswerResult {
  const validChoice = typeof choice === 'number' && Number.isInteger(choice) && choice >= 0 && choice < 4;
  const answerChoice = validChoice ? choice : null;
  const validTime = inAnswerWindow(elapsedMs);
  const correct = answerChoice !== null && validTime && answerChoice === q.correct;
  return {
    playerId,
    choice: answerChoice,
    elapsedMs: answerChoice !== null && validTime ? elapsedMs : ROUND_MS,
    correct,
    points: scoreAnswer(correct, elapsedMs),
  };
}

/** Modern JavaScript's stable sort preserves input order for equal scores. */
export function rankPlayers(players: Player[]): Player[] {
  return [...players].sort((a, b) => b.score - a.score);
}

export function botDecision(
  q: Question,
  difficulty: Difficulty,
  rng: () => number = Math.random,
): { choice: number; delayMs: number } {
  if (!isDifficulty(difficulty)) throw new RangeError('Invalid bot difficulty.');
  const { accuracy, minMs, maxMs } = BOT_SETTINGS[difficulty];
  const succeeds = randomUnit(rng) < accuracy;
  const wrongChoices = [0, 1, 2, 3].filter((index) => index !== q.correct);
  const choice = succeeds ? q.correct : wrongChoices[Math.floor(randomUnit(rng) * wrongChoices.length)];
  const delayMs = minMs + Math.floor(randomUnit(rng) * (maxMs - minMs + 1));
  return { choice, delayMs };
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const plain = value.normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  // Count Unicode code points, avoiding half of a surrogate pair at the boundary.
  return Array.from(plain).slice(0, 20).join('').trim();
}

/** Returns literal plain text, not HTML. Render as text, never with innerHTML. */
export function sanitizeName(value: unknown, fallback = 'Player'): string {
  return cleanName(value) || cleanName(fallback) || 'Player';
}

/** Validate untrusted room settings without coercion; drop unrelated properties. */
export function validateConfig(value: unknown): MatchConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Match config must be an object.');
  }
  const { category, rounds, difficulty } = value as Record<string, unknown>;
  if (!isCategory(category)) {
    throw new RangeError('Category must be general, puzzles, reasoning, or mixed.');
  }
  if (rounds !== 5 && rounds !== 10 && rounds !== 15) {
    throw new RangeError('Rounds must be 5, 10, or 15.');
  }
  if (!isDifficulty(difficulty)) {
    throw new RangeError('Difficulty must be easy, medium, or hard.');
  }
  return { category, rounds, difficulty };
}