import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalMatch } from '../src/game/localMatch';
import { QUESTIONS } from '../src/shared/questions';
import { COUNTDOWN_MS, REVEAL_MS, ROUND_MS } from '../src/shared/rules';
import { createMatchId } from '../src/lib/storage';

test('match IDs work without the secure-context-only randomUUID API', () => {
  const source: Pick<Crypto, 'getRandomValues'> = { getRandomValues: array => crypto.getRandomValues(array) };
  const ids = new Set(Array.from({ length: 100 }, () => createMatchId(source)));
  assert.equal(ids.size, 100);
  assert.ok([...ids].every(id => /^[0-9a-f]{8}(-[0-9a-f]{8}){3}$/.test(id)));
  assert.match(createMatchId(), /^[0-9a-f-]{36}$/);
});

test('same-phone match has one answer each, timed phases, final scores, and no extra rounds', t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000_000 });
  const match = new LocalMatch({ category: 'mixed', rounds: 5, difficulty: 'medium' }, ['Ada', 'Grace'], 'local');
  t.after(() => match.dispose());
  const phases: string[] = [];
  match.subscribe(s => phases.push(s.phase));
  assert.equal(match.submit('p1', 0), false);
  for (let round = 0; round < 5; round++) {
    assert.equal(match.state.phase, 'countdown');
    t.mock.timers.tick(COUNTDOWN_MS + 40);
    assert.equal(match.state.phase, 'question');
    assert.equal(match.state.round, round);
    const question = match.state.question!;
    assert.equal('correct' in question, false);
    const original = QUESTIONS.find(q => q.id === question.id)!;
    const correctIndex = question.options.indexOf(original.options[original.correct]);
    assert.equal(match.submit('outsider', correctIndex), false);
    assert.equal(match.submit('p1', -1), false);
    assert.equal(match.submit('p1', correctIndex), true);
    assert.equal(match.submit('p1', correctIndex), false);
    assert.equal(match.state.players[0].score, round * 1500);
    assert.equal(match.submit('p2', (correctIndex + 1) % 4), true);
    assert.equal(match.state.phase, 'reveal');
    assert.equal(match.state.history.length, round + 1);
    assert.equal(match.state.result?.answers[0].points, 1500);
    assert.equal(match.state.result?.answers[1].points, 0);
    assert.equal(match.submit('p2', correctIndex), false);
    t.mock.timers.tick(REVEAL_MS + 40);
  }
  assert.equal(match.state.phase, 'finished');
  assert.equal(match.state.players[0].score, 7500);
  assert.equal(match.state.players[0].correct, 5);
  assert.equal(match.state.players[1].score, 0);
  t.mock.timers.tick(60_000);
  assert.equal(match.state.history.length, 5);
  assert.ok(phases.includes('question'));
});

test('unanswered local questions time out to zero without accepting a late answer', t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000_000 });
  const match = new LocalMatch({ category: 'reasoning', rounds: 5, difficulty: 'easy' }, ['One', 'Two'], 'local');
  t.after(() => match.dispose());
  t.mock.timers.tick(COUNTDOWN_MS + 40);
  t.mock.timers.tick(ROUND_MS + 40);
  assert.equal(match.state.phase, 'reveal');
  assert.equal(match.submit('p1', 0), false);
  assert.ok(match.state.result?.answers.every(a => a.choice === null && a.points === 0));
});

test('computer answers on a delayed turn and never answers twice', t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000_000 });
  const match = new LocalMatch({ category: 'general', rounds: 5, difficulty: 'easy' }, ['You', 'Byte'], 'bot');
  t.after(() => match.dispose());
  t.mock.timers.tick(COUNTDOWN_MS + 40);
  assert.deepEqual(match.state.answeredIds, []);
  t.mock.timers.tick(11_000);
  assert.deepEqual(match.state.answeredIds, ['p2']);
  t.mock.timers.tick(1000);
  assert.deepEqual(match.state.answeredIds, ['p2']);
  match.submit('p1', 0);
  assert.equal(match.state.phase, 'reveal');
  assert.equal(match.state.result?.answers.length, 2);
});