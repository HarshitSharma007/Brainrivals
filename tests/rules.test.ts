import test from 'node:test';
import assert from 'node:assert/strict';
import { QUESTIONS } from '../src/shared/questions';
import {
  ROUND_MS, REVEAL_MS, COUNTDOWN_MS, scoreAnswer, publicQuestion,
  selectQuestions, makeAnswer, rankPlayers, botDecision, sanitizeName, validateConfig,
} from '../src/shared/rules';
import type { Category, CategorySelection, Difficulty, Player, Question } from '../src/shared/types';

const categories: Category[] = ['general', 'puzzles', 'reasoning'];
const difficulties: Difficulty[] = ['easy', 'medium', 'hard'];

function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function sequenceRng(values: number[]): () => number {
  let index = 0;
  return () => {
    assert.ok(index < values.length, 'Unexpected extra RNG call');
    return values[index++];
  };
}

function findQuestion(id: string): Question {
  const question = QUESTIONS.find((q) => q.id === id);
  assert.ok(question, `Missing question ${id}`);
  return question;
}

test('question bank has at least 90 valid, uniquely identified, original prompts', () => {
  assert.ok(QUESTIONS.length >= 90);
  const ids = new Set<string>();
  const prompts = new Set<string>();
  for (const q of QUESTIONS) {
    assert.equal(typeof q.id, 'string');
    assert.match(q.id, /^[a-z0-9-]+$/);
    assert.ok(!ids.has(q.id), `Duplicate ID: ${q.id}`);
    ids.add(q.id);
    assert.ok(categories.includes(q.category), q.id);
    assert.ok(difficulties.includes(q.difficulty), q.id);
    assert.equal(typeof q.prompt, 'string');
    assert.ok(q.prompt.trim().length > 0, q.id);
    const prompt = q.prompt.normalize('NFKC').trim().toLowerCase();
    assert.ok(!prompts.has(prompt), `Duplicate prompt: ${q.id}`);
    prompts.add(prompt);
    assert.ok(Array.isArray(q.options), q.id);
    assert.equal(q.options.length, 4, q.id);
    for (const option of q.options) {
      assert.equal(typeof option, 'string', q.id);
      assert.ok(option.trim().length > 0, q.id);
      assert.equal(option, option.trim(), q.id);
    }
    assert.equal(new Set(q.options.map((option) => option.normalize('NFKC').toLowerCase())).size, 4, q.id);
    assert.ok(Number.isInteger(q.correct) && q.correct >= 0 && q.correct < 4, q.id);
    assert.equal(typeof q.explanation, 'string', q.id);
    assert.ok(q.explanation.trim().length > 0, q.id);
  }
});

test('each category has at least 30 questions with balanced difficulty labels', () => {
  for (const category of categories) {
    const pool = QUESTIONS.filter((q) => q.category === category);
    assert.ok(pool.length >= 30, category);
    const counts = difficulties.map((difficulty) => pool.filter((q) => q.difficulty === difficulty).length);
    assert.ok(counts.every((count) => count >= 10), category);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, category);
  }
});

test('authored quantitative answers match independently calculated results', () => {
  const expected: Record<string, string> = {
    'puzzles-easy-01': `$${20 - 3 * 4}`,
    'puzzles-easy-02': `${2 * (8 / 4)} cups`,
    'puzzles-easy-03': '09:55',
    'puzzles-easy-04': String(24 / 6),
    'puzzles-easy-05': `${180 / 60} minutes`,
    'puzzles-easy-06': `${1_000 - 250} millilitres`,
    'puzzles-easy-07': `${2 * (6 + 4)} metres`,
    'puzzles-easy-08': `$${2 * 3}`,
    'puzzles-easy-09': `${18 / 6} hours`,
    'puzzles-easy-10': String(30 - 22),
    'puzzles-medium-01': `$${80 * 0.75}`,
    'puzzles-medium-02': `${150 / 2.5} km/h`,
    'puzzles-medium-03': String(Math.ceil(50 / 12)),
    'puzzles-medium-04': `${10 + 8 * (3 - 1)} litres`,
    'puzzles-medium-05': String((3 / 0.5) * (2 / 0.5)),
    'puzzles-medium-06': `$${(54 - 6) / 3}`,
    'puzzles-medium-07': '16:25',
    'puzzles-medium-08': `${500 * 2 / 5} millilitres`,
    'puzzles-medium-09': String((2_400 - 600) / 300),
    'puzzles-medium-10': String(Math.ceil(30 / 12)),
    'puzzles-hard-01': `$${200 * 0.8 * 0.9}`,
    'puzzles-hard-02': `${1 / (1 / 6 + 1 / 3)} hours`,
    'puzzles-hard-03': `${48 / (5 - 2)} minutes`,
    'puzzles-hard-04': `${48 / (9 + 15)} hours`,
    'puzzles-hard-05': String(4 * 85 - 70 - 80 - 90),
    'puzzles-hard-06': `${(2_000 - 800) / (80 - 50)} kilometres`,
    'puzzles-hard-07': `$${((2 * 6 + 3 * 10) / 5).toFixed(2)}`,
    'puzzles-hard-08': `${(45 / 5) * 4} minutes`,
    'puzzles-hard-09': String(180 / (30 - 18)),
    'puzzles-hard-10': `${8 * 6 - (8 - 2) * (6 - 2)} square metres`,
    'reasoning-easy-01': String(13 + 3),
    'reasoning-easy-02': String(24 * 2),
    'reasoning-easy-03': `${14 - 9} years`,
    'reasoning-easy-06': String(18 - 4),
    'reasoning-easy-07': `${8 + 6} years`,
    'reasoning-easy-10': String(17 + 5),
    'reasoning-medium-01': `${(30 - 6) / 2} years`,
    'reasoning-medium-02': `${36 - 2 * 12} years`,
    'reasoning-medium-03': String(67 * 3 + 1),
    'reasoning-medium-04': String(21 + 10),
    'reasoning-medium-08': String(16 + 5),
    'reasoning-medium-09': `${18 - (24 - 18)} years`,
    'reasoning-hard-01': `${12 / 2} years`,
    'reasoning-hard-02': `${(44 - 3 - 8) / 3 + 8} years`,
    'reasoning-hard-03': `${40 - 2 * 10} years`,
    'reasoning-hard-06': String(15 + 3),
    'reasoning-hard-07': String(33 * 2 - 1),
    'reasoning-hard-10': '47',
  };
  for (const [id, answer] of Object.entries(expected)) {
    const q = findQuestion(id);
    assert.equal(q.options[q.correct], answer, id);
  }
  const permutations: number[] = [];
  for (let number = 1_234; number <= 4_321; number += 1) {
    const digits = String(number).split('');
    if (digits.slice().sort().join('') === '1234' && number % 2 === 0 && digits[0] > digits[1]) {
      permutations.push(number);
    }
  }
  const q = findQuestion('reasoning-hard-08');
  assert.equal(q.options[q.correct], String(permutations.length));
});

test('shared phase durations match the game contract', () => {
  assert.equal(ROUND_MS, 15_000);
  assert.equal(REVEAL_MS, 4_000);
  assert.equal(COUNTDOWN_MS, 3_000);
});

test('scoring includes both time boundaries and exactly implements the speed bonus', () => {
  assert.equal(scoreAnswer(true, 0), 1_500);
  assert.equal(scoreAnswer(true, ROUND_MS / 2), 1_250);
  assert.equal(scoreAnswer(true, ROUND_MS), 1_000);
  assert.equal(scoreAnswer(true, 15), 1_500);
  assert.equal(scoreAnswer(true, 16), 1_499);
  let previous = 1_500;
  for (let elapsed = 0; elapsed <= ROUND_MS; elapsed += 1) {
    const score = scoreAnswer(true, elapsed);
    assert.equal(score, 1_000 + Math.round(500 * (1 - elapsed / ROUND_MS)));
    assert.ok(Number.isInteger(score) && score >= 1_000 && score <= 1_500);
    assert.ok(score <= previous);
    assert.equal(scoreAnswer(false, elapsed), 0);
    previous = score;
  }
  assert.equal(scoreAnswer(true, 1.5), 1_000 + Math.round(500 * (1 - 1.5 / ROUND_MS)));
});

test('invalid and out-of-window elapsed times never score', () => {
  for (const elapsed of [NaN, Infinity, -Infinity, -1, -0.001, ROUND_MS + 0.001, ROUND_MS + 1, Number.MAX_VALUE]) {
    assert.equal(scoreAnswer(true, elapsed), 0);
    assert.equal(scoreAnswer(false, elapsed), 0);
  }
  for (const elapsed of [null, undefined, '100', {}, []]) {
    assert.equal(scoreAnswer(true, elapsed as unknown as number), 0);
  }
});

test('selection is unique, category-specific, and does not filter out question difficulties', () => {
  for (const category of categories) {
    const observedDifficulties = new Set<Difficulty>();
    for (let seed = 1; seed <= 20; seed += 1) {
      const selected = selectQuestions(category, 15, seededRng(seed));
      assert.equal(selected.length, 15);
      assert.equal(new Set(selected.map((q) => q.id)).size, 15);
      assert.ok(selected.every((q) => q.category === category));
      selected.forEach((q) => observedDifficulties.add(q.difficulty));
    }
    assert.deepEqual([...observedDifficulties].sort(), [...difficulties].sort());
  }
});

test('every mixed count from zero through 15 is balanced, unique, and reproducible', () => {
  for (let count = 0; count <= 15; count += 1) {
    for (let seed = 1; seed <= 12; seed += 1) {
      const selected = selectQuestions('mixed', count, seededRng(seed));
      assert.equal(selected.length, count);
      assert.equal(new Set(selected.map((q) => q.id)).size, count);
      const counts = categories.map((category) => selected.filter((q) => q.category === category).length);
      assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
      assert.deepEqual(selected, selectQuestions('mixed', count, seededRng(seed)));
    }
  }
});

test('mixed extra slots can go to any category and question order varies with the seed', () => {
  const extraCategories = new Set<Category>();
  for (let seed = 0; seed < 100; seed += 1) {
    extraCategories.add(selectQuestions('mixed', 1, seededRng(seed * 100_003))[0].category);
  }
  assert.deepEqual([...extraCategories].sort(), [...categories].sort());
  const first = selectQuestions('mixed', 15, seededRng(1)).map((q) => q.id);
  const second = selectQuestions('mixed', 15, seededRng(2)).map((q) => q.id);
  assert.notDeepEqual(first, second);
});

test('selection copies question objects and options without mutating the bank', () => {
  const before = structuredClone(QUESTIONS);
  const selected = selectQuestions('mixed', 15, seededRng(20));
  for (const q of selected) {
    const original = findQuestion(q.id);
    assert.notStrictEqual(q, original);
    assert.notStrictEqual(q.options, original.options);
    assert.equal(q.options[q.correct], original.options[original.correct]);
    assert.deepEqual([...q.options].sort(), [...original.options].sort());
    assert.equal(q.explanation, original.explanation);
    q.prompt = 'Changed only in this match';
    q.options[0] = 'Changed option';
    q.correct = (q.correct + 1) % 4;
  }
  assert.deepEqual(QUESTIONS, before);
  const other = selectQuestions('mixed', 15, seededRng(20));
  assert.ok(other.every((q) => q.prompt !== 'Changed only in this match'));
});

test('shuffled options preserve answer identity and place the same answer in every slot across seeds', () => {
  const positionsById = new Map<string, Set<number>>();
  let changedOrder = false;
  for (let seed = 0; seed < 100; seed += 1) {
    for (const q of selectQuestions('mixed', 15, seededRng(seed * 10_007))) {
      const source = findQuestion(q.id);
      assert.ok(Number.isInteger(q.correct) && q.correct >= 0 && q.correct <= 3);
      assert.equal(q.options[q.correct], source.options[source.correct]);
      assert.deepEqual([...q.options].sort(), [...source.options].sort());
      changedOrder ||= q.options.some((option, index) => option !== source.options[index]);
      const positions = positionsById.get(q.id) ?? new Set<number>();
      positions.add(q.correct);
      positionsById.set(q.id, positions);
    }
  }
  assert.ok(changedOrder);
  assert.ok([...positionsById.values()].some((positions) => positions.size === 4));
});

test('selection rejects invalid categories and unbounded or fractional counts', () => {
  for (const category of ['unknown', 'GENERAL', '', null, undefined, {}, '__proto__']) {
    assert.throws(() => selectQuestions(category as CategorySelection, 5), RangeError);
  }
  for (const count of [-1, 1.5, 16, 100_000, NaN, Infinity, -Infinity, '5', null, undefined]) {
    assert.throws(() => selectQuestions('mixed', count as number), RangeError);
  }
  assert.deepEqual(selectQuestions('general', 0, () => { throw new Error('Must not sample for zero questions'); }), []);
});

test('public questions are explicit copies with no answer key or explanation', () => {
  const q = selectQuestions('general', 1, seededRng(42))[0];
  const visible = publicQuestion({ ...q, extraSecret: 'private' } as Question);
  assert.deepEqual(Object.keys(visible).sort(), ['id', 'category', 'difficulty', 'prompt', 'options'].sort());
  const wire = JSON.parse(JSON.stringify(visible)) as Record<string, unknown>;
  assert.equal('correct' in wire, false);
  assert.equal('explanation' in wire, false);
  assert.equal('extraSecret' in wire, false);
  assert.deepEqual(visible, {
    id: q.id, category: q.category, difficulty: q.difficulty, prompt: q.prompt, options: q.options,
  });
  assert.notStrictEqual(visible.options, q.options);
  visible.options[0] = 'Client-only edit';
  assert.notEqual(q.options[0], 'Client-only edit');
});

test('makeAnswer scores the current shuffled key and records wrong and timeout answers', () => {
  const q = selectQuestions('reasoning', 1, seededRng(81))[0];
  for (const elapsedMs of [0, ROUND_MS / 2, ROUND_MS]) {
    assert.deepEqual(makeAnswer(q, 'p1', q.correct, elapsedMs), {
      playerId: 'p1', choice: q.correct, elapsedMs, correct: true, points: scoreAnswer(true, elapsedMs),
    });
  }
  const wrongChoice = (q.correct + 1) % 4;
  assert.deepEqual(makeAnswer(q, 'p2', wrongChoice, 2_000), {
    playerId: 'p2', choice: wrongChoice, elapsedMs: 2_000, correct: false, points: 0,
  });
  for (const elapsedMs of [0, 1_000, ROUND_MS, Infinity]) {
    assert.deepEqual(makeAnswer(q, 'p3', null, elapsedMs), {
      playerId: 'p3', choice: null, elapsedMs: ROUND_MS, correct: false, points: 0,
    });
  }
});

test('makeAnswer does not coerce invalid choices or reward late/invalid-time answers', () => {
  const q = QUESTIONS[0];
  for (const choice of [-1, 4, 1.5, NaN, Infinity, -Infinity, '1', true, {}, undefined]) {
    assert.deepEqual(makeAnswer(q, 'p', choice as number, 1_000), {
      playerId: 'p', choice: null, elapsedMs: ROUND_MS, correct: false, points: 0,
    });
  }
  for (const elapsedMs of [-1, NaN, Infinity, -Infinity, ROUND_MS + 1, Number.MAX_VALUE]) {
    assert.deepEqual(makeAnswer(q, 'p', q.correct, elapsedMs), {
      playerId: 'p', choice: q.correct, elapsedMs: ROUND_MS, correct: false, points: 0,
    });
  }
});

test('rankPlayers sorts only score, preserves ties, and leaves its input unchanged', () => {
  const players: Player[] = [
    { id: 'first-tie', name: 'A', score: 100, correct: 1, totalMs: 14_000 },
    { id: 'low', name: 'B', score: 50, correct: 50, totalMs: 1 },
    { id: 'second-tie', name: 'C', score: 100, correct: 99, totalMs: 1 },
    { id: 'winner', name: 'D', score: 101, correct: 0, totalMs: 90_000 },
    { id: 'third-tie', name: 'E', score: 100, correct: 0, totalMs: 5_000 },
  ];
  const before = structuredClone(players);
  const ranked = rankPlayers(players);
  assert.deepEqual(ranked.map((p) => p.id), ['winner', 'first-tie', 'second-tie', 'third-tie', 'low']);
  assert.deepEqual(players, before);
  assert.notStrictEqual(ranked, players);
  assert.deepEqual(rankPlayers([]), []);
  assert.deepEqual(rankPlayers([players[0]]), [players[0]]);
  const ties = players.filter((p) => p.score === 100).reverse();
  assert.deepEqual(rankPlayers(ties), ties);
});

test('bot probabilities, wrong choices, and delay boundaries are deterministic', () => {
  const settings = [
    { difficulty: 'easy', accuracy: 0.55, min: 4_000, max: 10_000 },
    { difficulty: 'medium', accuracy: 0.75, min: 2_500, max: 7_000 },
    { difficulty: 'hard', accuracy: 0.9, min: 1_300, max: 4_500 },
  ] as const;
  for (const { difficulty, accuracy, min, max } of settings) {
    for (let correct = 0; correct < 4; correct += 1) {
      const q = { ...QUESTIONS[0], correct };
      assert.deepEqual(botDecision(q, difficulty, sequenceRng([accuracy - 0.000001, 0])), {
        choice: correct, delayMs: min,
      });
      const wrongChoices = [0, 1, 2, 3].filter((index) => index !== correct);
      for (let index = 0; index < 3; index += 1) {
        assert.deepEqual(botDecision(q, difficulty, sequenceRng([accuracy, (index + 0.5) / 3, 1 - Number.EPSILON])), {
          choice: wrongChoices[index], delayMs: max,
        });
      }
      assert.ok(min > 0 && max < ROUND_MS);
    }
  }
});

test('seeded bot samples approximate target accuracy and always return safe, non-instant decisions', () => {
  const expected = { easy: 0.55, medium: 0.75, hard: 0.9 };
  const ranges = { easy: [4_000, 10_000], medium: [2_500, 7_000], hard: [1_300, 4_500] };
  const q = QUESTIONS[0];
  const before = structuredClone(q);
  for (const difficulty of difficulties) {
    let successes = 0;
    const rng = seededRng(123_456);
    for (let trial = 0; trial < 10_000; trial += 1) {
      const result = botDecision(q, difficulty, rng);
      successes += Number(result.choice === q.correct);
      assert.ok(Number.isInteger(result.choice) && result.choice >= 0 && result.choice < 4);
      assert.ok(Number.isInteger(result.delayMs));
      assert.ok(result.delayMs >= ranges[difficulty][0] && result.delayMs <= ranges[difficulty][1]);
      assert.ok(result.delayMs > 0 && result.delayMs < ROUND_MS);
    }
    assert.ok(Math.abs(successes / 10_000 - expected[difficulty]) < 0.02, difficulty);
    assert.deepEqual(botDecision(q, difficulty, seededRng(77)), botDecision(q, difficulty, seededRng(77)));
    assert.deepEqual(botDecision({ ...q, difficulty: 'easy' }, difficulty, seededRng(99)),
      botDecision({ ...q, difficulty: 'hard' }, difficulty, seededRng(99)));
  }
  assert.deepEqual(q, before);
});

test('invalid bot difficulty and malformed RNG outputs fail explicitly', () => {
  for (const difficulty of ['expert', '', null, '__proto__', 'toString']) {
    assert.throws(() => botDecision(QUESTIONS[0], difficulty as Difficulty), RangeError);
  }
  for (const value of [NaN, Infinity, -Infinity, -0.001, 1, 2]) {
    assert.throws(() => selectQuestions('mixed', 5, () => value), RangeError);
    assert.throws(() => botDecision(QUESTIONS[0], 'easy', () => value), RangeError);
  }
  for (const rng of [() => 0, () => 1 - Number.EPSILON]) {
    const selected = selectQuestions('mixed', 15, rng);
    assert.equal(selected.length, 15);
    assert.equal(new Set(selected.map((q) => q.id)).size, 15);
    assert.ok(selected.every((q) => q.correct >= 0 && q.correct < 4));
  }
});

test('names normalize, remove controls, trim, and limit Unicode code points to 20', () => {
  assert.equal(sanitizeName('  Ada   Lovelace  '), 'Ada Lovelace');
  assert.equal(sanitizeName('  Ａｄａ  '), 'Ada');
  assert.equal(sanitizeName('Jose\u0301'), 'José');
  assert.equal(sanitizeName(' A\u0000\u0007\u001b\u007f\u0085\u200b\u202eB\n\t '), 'AB');
  assert.equal(sanitizeName('a'.repeat(50)), 'a'.repeat(20));
  const emoji = sanitizeName('😀'.repeat(21));
  assert.equal(emoji, '😀'.repeat(20));
  assert.equal(Array.from(emoji).length, 20);
  assert.equal(sanitizeName('\ud800Ada\udfff'), 'Ada');
  assert.equal(sanitizeName('x'.repeat(19) + ' y'), 'x'.repeat(19));
});

test('name fallbacks are sanitized and unknown inputs are not coerced or parsed as HTML', () => {
  for (const value of [null, undefined, 42, false, {}, [], '', '   ', '\u0000\u200b']) {
    assert.equal(sanitizeName(value), 'Player');
    assert.equal(sanitizeName(value, '  Guest  '), 'Guest');
  }
  assert.equal(sanitizeName(null, '\u0000'), 'Player');
  assert.equal(sanitizeName(null, 'G'.repeat(50)), 'G'.repeat(20));
  assert.equal(sanitizeName(null, undefined), 'Player');
  assert.equal(sanitizeName({ toString: () => { throw new Error('Must not coerce objects'); } }), 'Player');
  assert.equal(sanitizeName('<b>Ada</b>'), '<b>Ada</b>');
  assert.equal(sanitizeName('&lt;Ada&gt;'), '&lt;Ada&gt;');
});

test('config validation accepts exactly the supported combinations and returns a clean copy', () => {
  const selections: CategorySelection[] = [...categories, 'mixed'];
  for (const category of selections) {
    for (const rounds of [5, 10, 15] as const) {
      for (const difficulty of difficulties) {
        const input = { category, rounds, difficulty, extra: 'not part of config' };
        const config = validateConfig(input);
        assert.deepEqual(config, { category, rounds, difficulty });
        assert.notStrictEqual(config, input);
        assert.equal('extra' in config, false);
        assert.equal(input.extra, 'not part of config');
      }
    }
  }
});

test('config validation rejects malformed objects, unsupported labels, and unbounded round counts', () => {
  for (const config of [null, undefined, false, 5, 'mixed', [], () => null]) {
    assert.throws(() => validateConfig(config), TypeError);
  }
  const valid = { category: 'mixed', rounds: 5, difficulty: 'medium' };
  for (const category of ['', 'GENERAL', 'all', 'unknown', '__proto__', null, undefined, 1, {}]) {
    assert.throws(() => validateConfig({ ...valid, category }), /Category/);
  }
  for (const rounds of [0, -5, 1, 4, 6, 20, 5.5, '5', NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, null, undefined, [], {}]) {
    assert.throws(() => validateConfig({ ...valid, rounds }), /Rounds/);
  }
  for (const difficulty of ['', 'Medium', 'expert', '__proto__', 'toString', null, undefined, 1, {}]) {
    assert.throws(() => validateConfig({ ...valid, difficulty }), /Difficulty/);
  }
  for (const config of [{}, { rounds: 5, difficulty: 'medium' }, { category: 'mixed', difficulty: 'medium' }, { category: 'mixed', rounds: 5 }]) {
    assert.throws(() => validateConfig(config));
  }
});