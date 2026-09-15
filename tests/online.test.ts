import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { createGameServer, type GameServerOptions } from '../server/index.js';
import { makeAnswer, sanitizeName } from '../src/shared/rules.js';
import { QUESTIONS } from '../src/shared/questions.js';
import type { Ack, MatchConfig, Player, RoomState } from '../src/shared/types.js';

const ORIGIN = 'http://localhost:5173';
const CONFIG: MatchConfig = { category: 'mixed', rounds: 5, difficulty: 'medium' };
const TEST_OPTIONS = { timeout: 20_000 };
const EVENT_TIMEOUT = 5_000;

test('one host serves only built web files alongside health and Socket.IO', TEST_OPTIONS, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'brainrivals-web-'));
  writeFileSync(join(directory, 'index.html'), '<!doctype html><title>BrainRivals fixture</title>');
  writeFileSync(join(directory, 'game.js'), 'console.log("fixture");');
  writeFileSync(join(directory, '.env'), 'PRIVATE_FIXTURE=true');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fixture = await setup(t, { staticDir: directory });
  const home = await fetch(fixture.url);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type')!, /text\/html/);
  assert.equal(home.headers.get('cache-control'), 'no-cache');
  assert.match(await home.text(), /BrainRivals fixture/);
  const script = await fetch(`${fixture.url}/game.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type')!, /javascript/);
  for (const path of ['/.env', '/server/index.ts', '/missing.js', '/package.json']) {
    assert.equal((await fetch(`${fixture.url}${path}`)).status, 404, path);
  }
  assert.equal((await fetch(fixture.url, { method: 'POST' })).status, 404);
  assert.equal((await fetch(`${fixture.url}/game.js`, { method: 'HEAD' })).status, 200);
  assert.deepEqual(await (await fetch(`${fixture.url}/health`)).json(), { ok: true });
  const client = await fixture.client();
  assert.ok(await createRoom(client));
});

test('Render public URL is allowlisted without trusting arbitrary host headers', TEST_OPTIONS, async t => {
  const previous = process.env.RENDER_EXTERNAL_URL;
  const previousAllowlist = process.env.ALLOWED_ORIGINS;
  process.env.RENDER_EXTERNAL_URL = 'https://brainrivals-test.onrender.com';
  process.env.ALLOWED_ORIGINS = 'https://localhost';
  let server: Awaited<ReturnType<typeof createGameServer>> | undefined;
  try {
    server = await createGameServer({ port: 0, host: '127.0.0.1', staticDir: false });
  } finally {
    if (previous === undefined) delete process.env.RENDER_EXTERNAL_URL; else process.env.RENDER_EXTERNAL_URL = previous;
    if (previousAllowlist === undefined) delete process.env.ALLOWED_ORIGINS; else process.env.ALLOWED_ORIGINS = previousAllowlist;
  }
  t.after(() => server!.close());
  const url = `http://127.0.0.1:${server.port}`;
  const web = await connect(t, url, 'websocket', 'https://brainrivals-test.onrender.com');
  const android = await connect(t, url, 'polling', 'https://localhost');
  assert.ok(await pair(web, android));
  await assert.rejects(connect(t, url, 'websocket', 'https://untrusted.example'));
});

test('web hosting fails clearly when its build directory is absent', TEST_OPTIONS, async () => {
  await assert.rejects(createGameServer({ port: 0, staticDir: join(tmpdir(), 'brainrivals-missing', 'no-build') }), /Build the web app/);
});

test('room tests override SERVE_WEB while production still requires a web build', TEST_OPTIONS, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'brainrivals-before-build-'));
  const previousDirectory = process.cwd();
  const previousServeWeb = process.env.SERVE_WEB;
  try {
    process.chdir(directory);
    process.env.SERVE_WEB = '1';
    await assert.rejects(createGameServer({ port: 0, origins: [ORIGIN] }), /Build the web app/);
    const fixture = await setup(t);
    assert.deepEqual(await (await fetch(`${fixture.url}/health`)).json(), { ok: true });
    assert.equal((await fetch(fixture.url)).status, 404);
    const host = await fixture.client();
    const guest = await fixture.client();
    assert.ok(await pair(host, guest));
  } finally {
    process.chdir(previousDirectory);
    if (previousServeWeb === undefined) delete process.env.SERVE_WEB; else process.env.SERVE_WEB = previousServeWeb;
    rmSync(directory, { recursive: true, force: true });
  }
});

// Record before connecting/emitting: state broadcasts can arrive before an acknowledgement.
function eventLog<T>(socket: Socket, event: string) {
  const values: T[] = [];
  socket.on(event, (value: T) => values.push(value));
  return {
    values,
    waitFor(predicate: (value: T) => boolean, from = 0): Promise<T> {
      const existing = values.slice(from).find(predicate);
      if (existing !== undefined) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const onEvent = (value: T) => {
          if (!predicate(value)) return;
          clearTimeout(timer);
          socket.off(event, onEvent);
          resolve(value);
        };
        const timer = setTimeout(() => {
          socket.off(event, onEvent);
          reject(new Error(`Timed out waiting for ${event}`));
        }, EVENT_TIMEOUT);
        socket.on(event, onEvent);
      });
    },
  };
}

async function connect(
  t: TestContext,
  url: string,
  transport: 'websocket' | 'polling' = 'websocket',
  origin: string | null = ORIGIN,
) {
  const socket = io(url, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    transports: [transport],
    extraHeaders: origin === null ? {} : { Origin: origin },
    timeout: EVENT_TIMEOUT,
  });
  const states = eventLog<RoomState>(socket, 'room:state');
  const times = eventLog<number>(socket, 'server:time');
  const closed = eventLog<string>(socket, 'room:closed');
  t.after(() => { socket.disconnect(); });
  const connected = new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
    };
    const onConnect = () => { cleanup(); resolve(); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Connection timed out')); }, EVENT_TIMEOUT);
    socket.once('connect', onConnect);
    socket.once('connect_error', onError);
  });
  socket.connect();
  await connected;
  await times.waitFor((now) => Number.isFinite(now));
  return { socket, states, times, closed };
}
type Client = Awaited<ReturnType<typeof connect>>;

function send(client: Client, event: string, ...args: unknown[]): Promise<Ack> {
  return new Promise((resolve, reject) => {
    client.socket.timeout(EVENT_TIMEOUT).emit(event, ...args, (error: Error | null, ack: Ack) => {
      if (error) reject(error);
      else {
        try {
          assert.equal(typeof ack?.ok, 'boolean', `${event} must acknowledge with Ack`);
          resolve(ack);
        } catch (failure) { reject(failure); }
      }
    });
  });
}

async function denied(client: Client, event: string, ...args: unknown[]): Promise<Ack> {
  const ack = await send(client, event, ...args);
  assert.equal(ack.ok, false, `${event} should be rejected`);
  assert.equal(typeof ack.error, 'string');
  return ack;
}

async function setup(t: TestContext, options: GameServerOptions = {}) {
  const server = await createGameServer({
    port: 0, host: '127.0.0.1', origins: [ORIGIN],
    staticDir: false,
    roundMs: 3_000, revealMs: 40, countdownMs: 40, roomTtlMs: 60_000,
    ...options,
  });
  t.after(async () => { await server.close(); });
  const url = `http://127.0.0.1:${server.port}`;
  return { server, url, client: (transport?: 'websocket' | 'polling') => connect(t, url, transport) };
}

async function createRoom(host: Client, name = '  Ada  '): Promise<string> {
  const ack = await send(host, 'room:create', { name, config: CONFIG });
  assert.equal(ack.ok, true);
  assert.equal(ack.playerId, host.socket.id);
  assert.match(ack.code!, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  return ack.code!;
}

async function pair(host: Client, guest: Client): Promise<string> {
  const code = await createRoom(host);
  const ack = await send(guest, 'room:join', { name: 'Grace', code: ` ${code.toLowerCase()} ` });
  assert.equal(ack.ok, true);
  assert.equal(ack.code, code);
  assert.equal(ack.playerId, guest.socket.id);
  return code;
}

function publicOnly(question: RoomState['question']): void {
  assert.ok(question);
  assert.equal(Object.hasOwn(question, 'correct'), false);
  assert.equal(Object.hasOwn(question, 'explanation'), false);
  assert.deepEqual(Object.keys(question).sort(), ['category', 'difficulty', 'id', 'options', 'prompt']);
  assert.equal(question.options.length, 4);
}

function totals(players: Player[]) {
  return players.map(({ id, score, correct, totalMs }) => ({ id, score, correct, totalMs }));
}

test('health, sanitized create/join, host guards, two-player cap and single membership', TEST_OPTIONS, async (t) => {
  const fixture = await setup(t);
  const health = await fetch(`${fixture.url}/health`);
  assert.equal(health.status, 200);
  assert.match(health.headers.get('content-type')!, /application\/json/);
  assert.deepEqual(await health.json(), { ok: true });
  const host = await fixture.client();
  const guest = await fixture.client();
  const outsider = await fixture.client();
  await denied(host, 'room:create', { name: null });
  for (const config of [
    { ...CONFIG, rounds: 6 },
    { ...CONFIG, category: 'unknown' },
    { ...CONFIG, difficulty: 'unknown' },
  ]) await denied(host, 'room:create', { name: 'Ada', config });
  await denied(outsider, 'room:start');
  const code = await createRoom(host);
  const lobby = await host.states.waitFor((state) => state.phase === 'lobby');
  assert.equal(lobby.hostId, host.socket.id);
  assert.equal(lobby.players[0].name, sanitizeName('  Ada  '));
  assert.deepEqual(lobby.config, CONFIG);
  assert.equal(lobby.question, null);
  assert.equal(lobby.result, null);
  assert.deepEqual(lobby.history, []);
  await denied(host, 'room:start');
  await denied(host, 'room:create', { name: 'Duplicate', config: CONFIG });
  await denied(host, 'room:join', { name: 'Duplicate', code });
  await denied(guest, 'room:join', { name: 'Guest', code: '!!!!!!' });
  assert.equal((await send(guest, 'room:join', { name: '  Grace  ', code: ` ${code.toLowerCase()} ` })).ok, true);
  const joined = await host.states.waitFor((state) => state.players.length === 2);
  assert.equal(joined.players[1].name, sanitizeName('  Grace  '));
  await denied(guest, 'room:join', { name: 'Duplicate', code });
  await denied(guest, 'room:create', { name: 'Duplicate', config: CONFIG });
  assert.match((await denied(outsider, 'room:join', { name: 'Third', code })).error!, /full/i);
  await denied(guest, 'room:start');
  assert.equal((await send(host, 'room:start')).ok, true);
  const countdown = await host.states.waitFor((state) => state.phase === 'countdown');
  assert.equal(countdown.question, null);
  assert.equal(countdown.result, null);
  assert.equal(countdown.startsAt, countdown.deadline);
  await denied(host, 'room:start');
  await denied(guest, 'round:answer', { questionId: 'not-open', choice: 0 });
  assert.deepEqual(outsider.states.values, []);
});

test('authoritative answers, reveal-only keys, exactly-once history/scoring, full match and rematch', TEST_OPTIONS, async (t) => {
  const fixture = await setup(t);
  const host = await fixture.client();
  const guest = await fixture.client();
  const outsider = await fixture.client();
  await pair(host, guest);
  const startMark = host.states.values.length;
  assert.equal((await send(host, 'room:start')).ok, true);
  let previousQuestionId: string | undefined;
  let previousPlayers: Player[] | undefined;

  for (let index = 0; index < CONFIG.rounds; index += 1) {
    const state = await host.states.waitFor((item) => item.phase === 'question' && item.round === index, startMark);
    publicOnly(state.question);
    const questionId = state.question!.id;
    // Only the test reads the trusted bank. Match by option text because selection shuffles options.
    const original = QUESTIONS.find((question) => question.id === questionId)!;
    assert.ok(original);
    const hostChoice = state.question!.options.indexOf(original.options[original.correct]);
    assert.ok(hostChoice >= 0);
    const guestChoice = index % 2 === 0 ? hostChoice : (hostChoice + 1) % 4;
    assert.equal(state.result, null);
    assert.equal(state.history.length, index);
    assert.ok(state.history.every((entry) => entry.index < index));
    assert.deepEqual(state.answeredIds, []);
    assert.equal(state.deadline - state.startsAt, 3_000);
    assert.ok(state.startsAt <= Date.now());
    assert.ok(host.times.values.length >= host.states.values.length + 1);
    if (previousPlayers) assert.deepEqual(totals(state.players), totals(previousPlayers));

    if (index === 0) {
      await denied(outsider, 'round:answer', { questionId, choice: 0, playerId: host.socket.id });
      await denied(host, 'round:answer', { questionId: 'wrong-question-id', choice: 0 });
      await denied(host, 'round:answer', null);
      for (const choice of [-1, 4, 0.5, '0', null]) {
        await denied(host, 'round:answer', { questionId, choice });
      }
    }
    if (previousQuestionId) await denied(host, 'round:answer', { questionId: previousQuestionId, choice: 0 });

    const answerMark = host.states.values.length;
    const sentAt = Date.now();
    assert.equal((await send(host, 'round:answer', {
      questionId, choice: hostChoice, playerId: guest.socket.id,
      elapsedMs: -123_456, timestamp: 0, score: 999_999, correct: true,
    })).ok, true);
    const acknowledgedAt = Date.now();
    const oneAnswer = await host.states.waitFor((item) => item.phase === 'question'
      && item.round === index && item.answeredIds.length === 1, answerMark);
    assert.deepEqual(oneAnswer.answeredIds, [host.socket.id]);
    assert.equal(oneAnswer.result, null);
    assert.deepEqual(totals(oneAnswer.players), totals(state.players));
    publicOnly(oneAnswer.question);
    await denied(host, 'round:answer', { questionId, choice: (hostChoice + 1) % 4 });
    assert.equal((await send(guest, 'round:answer', { questionId, choice: guestChoice, playerId: host.socket.id })).ok, true);
    const revealed = await host.states.waitFor((item) => item.phase === 'reveal' && item.round === index, answerMark);
    assert.ok(revealed.result);
    assert.equal(revealed.result.index, index);
    assert.equal(revealed.result.question.id, questionId);
    assert.equal(typeof revealed.result.question.correct, 'number');
    assert.equal(typeof revealed.result.question.explanation, 'string');
    assert.ok(revealed.result.question.explanation.length > 0);
    assert.equal(revealed.deadline - revealed.startsAt, 40);
    assert.equal(revealed.history.length, index + 1);
    assert.deepEqual(revealed.history[index], revealed.result);
    assert.equal(new Set(revealed.history.map((entry) => entry.index)).size, index + 1);
    assert.deepEqual(revealed.history.slice(0, index), state.history);
    assert.deepEqual(new Set(revealed.answeredIds), new Set([host.socket.id, guest.socket.id]));
    assert.equal(revealed.result.answers.length, 2);
    for (const answer of revealed.result.answers) {
      const choice = answer.playerId === host.socket.id ? hostChoice : guestChoice;
      assert.equal(answer.choice, choice);
      assert.ok(answer.elapsedMs >= 0 && answer.elapsedMs < 3_000);
      assert.equal(answer.correct, choice === revealed.result.question.correct);
      assert.deepEqual(answer, makeAnswer(revealed.result.question, answer.playerId, choice, answer.elapsedMs));
      const before = state.players.find((player) => player.id === answer.playerId)!;
      const after = revealed.players.find((player) => player.id === answer.playerId)!;
      assert.equal(after.score, before.score + answer.points);
      assert.equal(after.correct, before.correct + Number(answer.correct));
      assert.equal(after.totalMs, before.totalMs + (answer.correct ? answer.elapsedMs : 0));
    }
    const hostAnswer = revealed.result.answers.find((answer) => answer.playerId === host.socket.id)!;
    assert.ok(hostAnswer.elapsedMs >= Math.max(0, sentAt - state.startsAt));
    assert.ok(hostAnswer.elapsedMs <= acknowledgedAt - state.startsAt);
    assert.equal(hostAnswer.correct, true);
    const guestAnswer = revealed.result.answers.find((answer) => answer.playerId === guest.socket.id)!;
    assert.ok(hostAnswer.elapsedMs <= guestAnswer.elapsedMs);
    assert.ok(hostAnswer.points >= guestAnswer.points);
    assert.equal(guestAnswer.correct, index % 2 === 0);
    await denied(guest, 'round:answer', { questionId, choice: 1 });
    previousQuestionId = questionId;
    previousPlayers = revealed.players;
  }

  const finished = await host.states.waitFor((state) => state.phase === 'finished', startMark);
  assert.equal(finished.history.length, CONFIG.rounds);
  assert.equal(finished.result?.index, CONFIG.rounds - 1);
  assert.equal(finished.startsAt, 0);
  assert.equal(finished.deadline, 0);
  assert.deepEqual(totals(finished.players), totals(previousPlayers!));
  assert.equal(host.states.values.filter((state) => state.phase === 'reveal').length, CONFIG.rounds);
  for (let index = 0; index < CONFIG.rounds; index += 1) {
    const countdown = host.states.values.find((state) => state.phase === 'countdown' && state.round === index)!;
    assert.ok(countdown);
    assert.equal(countdown.history.length, index);
    assert.equal(countdown.question, null);
    assert.equal(countdown.result, null);
  }
  await denied(guest, 'room:start');
  const rematchMark = host.states.values.length;
  assert.equal((await send(host, 'room:start')).ok, true);
  const rematch = await host.states.waitFor((state) => state.phase === 'countdown', rematchMark);
  assert.equal(rematch.round, 0);
  assert.deepEqual(rematch.history, []);
  assert.equal(rematch.result, null);
  assert.equal(rematch.players.length, 2);
  assert.ok(rematch.players.every((player) => player.score === 0 && player.correct === 0 && player.totalMs === 0));
  assert.deepEqual(outsider.states.values, []);
});

test('timeouts reveal null unanswered choices, reject late answers, and finish after final reveal', TEST_OPTIONS, async (t) => {
  const fixture = await setup(t, { roundMs: 100, countdownMs: 20, revealMs: 20 });
  const host = await fixture.client();
  const guest = await fixture.client();
  await pair(host, guest);
  assert.equal((await send(host, 'room:start')).ok, true);
  const first = await host.states.waitFor((state) => state.phase === 'reveal' && state.round === 0);
  await denied(host, 'round:answer', { questionId: first.result!.question.id, choice: 0 });
  const finished = await host.states.waitFor((state) => state.phase === 'finished');
  assert.equal(finished.history.length, CONFIG.rounds);
  assert.equal(new Set(finished.history.map((entry) => entry.index)).size, CONFIG.rounds);
  for (const result of finished.history) {
    assert.equal(result.answers.length, 2);
    for (const answer of result.answers) {
      assert.deepEqual(answer, makeAnswer(result.question, answer.playerId, null, 100));
      assert.equal(answer.choice, null);
      assert.equal(answer.correct, false);
      assert.equal(answer.points, 0);
    }
  }
  assert.ok(finished.players.every((player) => player.score === 0 && player.correct === 0 && player.totalMs === 0));
  const finalReveal = host.states.values.find((state) => state.phase === 'reveal' && state.round === CONFIG.rounds - 1)!;
  assert.ok(finalReveal);
  assert.deepEqual(finalReveal.history, finished.history);
  assert.ok(host.states.values.indexOf(finalReveal) < host.states.values.indexOf(finished));
});

test('one submitted answer remains hidden until the other player times out', TEST_OPTIONS, async (t) => {
  const fixture = await setup(t, { roundMs: 1_000 });
  const host = await fixture.client();
  const guest = await fixture.client();
  await pair(host, guest);
  assert.equal((await send(host, 'room:start')).ok, true);
  const question = await host.states.waitFor((state) => state.phase === 'question');
  assert.equal((await send(host, 'round:answer', { questionId: question.question!.id, choice: 3 })).ok, true);
  const waiting = await host.states.waitFor((state) => state.phase === 'question' && state.answeredIds.length === 1);
  publicOnly(waiting.question);
  assert.equal(waiting.result, null);
  assert.ok(waiting.players.every((player) => player.score === 0 && player.correct === 0));
  const revealed = await host.states.waitFor((state) => state.phase === 'reveal');
  assert.equal(revealed.result!.answers.find((answer) => answer.playerId === host.socket.id)!.choice, 3);
  const missed = revealed.result!.answers.find((answer) => answer.playerId === guest.socket.id)!;
  assert.deepEqual(missed, makeAnswer(revealed.result!.question, guest.socket.id!, null, 1_000));
});

test('disconnect abandons and removes the room, clears the survivor membership, and never reconnects', TEST_OPTIONS, async (t) => {
  const fixture = await setup(t);
  const host = await fixture.client();
  const guest = await fixture.client();
  const outsider = await fixture.client();
  const code = await pair(host, guest);
  const mark = host.states.values.length;
  guest.socket.disconnect();
  const abandoned = await host.states.waitFor((state) => state.phase === 'abandoned', mark);
  assert.equal(abandoned.code, code);
  assert.deepEqual(abandoned.players.map((player) => player.id), [host.socket.id]);
  assert.equal(typeof await host.closed.waitFor(() => true), 'string');
  assert.equal(abandoned.question, null);
  assert.equal(abandoned.deadline, 0);
  await denied(outsider, 'room:join', { name: 'Third', code });
  await denied(host, 'room:start');

  const newCode = await pair(host, outsider);
  assert.equal((await send(host, 'room:start')).ok, true);
  await outsider.states.waitFor((state) => state.code === newCode && state.phase === 'question');
  const outsiderMark = outsider.states.values.length;
  host.socket.disconnect();
  const activeAbandoned = await outsider.states.waitFor((state) => state.phase === 'abandoned', outsiderMark);
  assert.equal(activeAbandoned.code, newCode);
  assert.equal(activeAbandoned.result, null);
  assert.deepEqual(activeAbandoned.history, []);
  const returning = await fixture.client();
  await denied(returning, 'room:join', { name: 'Ada', code: newCode });
  await createRoom(outsider);
});

test('explicit leave removes empty rooms and invalidates both memberships in a full room', TEST_OPTIONS, async (t) => {
  const fixture = await setup(t);
  const host = await fixture.client();
  const guest = await fixture.client();
  const emptyCode = await createRoom(host);
  assert.equal((await send(host, 'room:leave')).ok, true);
  await denied(guest, 'room:join', { name: 'Grace', code: emptyCode });
  assert.equal((await send(host, 'room:leave')).ok, true);
  const fullCode = await pair(host, guest);
  assert.equal((await send(host, 'room:leave')).ok, true);
  const abandoned = await guest.states.waitFor((state) => state.code === fullCode && state.phase === 'abandoned');
  assert.equal(abandoned.players.length, 1);
  await createRoom(host);
  await createRoom(guest);
});

test('stale lobby TTL releases the code and membership', TEST_OPTIONS, async (t) => {
  const fixture = await setup(t, { roomTtlMs: 150 });
  const host = await fixture.client();
  const guest = await fixture.client();
  const code = await createRoom(host);
  const expired = await host.states.waitFor((state) => state.phase === 'abandoned');
  assert.match(expired.message!, /expired/i);
  assert.match(await host.closed.waitFor(() => true), /expired/i);
  await denied(guest, 'room:join', { name: 'Grace', code });
  await createRoom(host);
});

test('MAX_ROOMS limits live rooms and releases capacity after the last player leaves', TEST_OPTIONS, async (t) => {
  const previousLimit = process.env.MAX_ROOMS;
  let fixture: Awaited<ReturnType<typeof setup>>;
  try {
    process.env.MAX_ROOMS = '1';
    fixture = await setup(t);
  } finally {
    if (previousLimit === undefined) delete process.env.MAX_ROOMS;
    else process.env.MAX_ROOMS = previousLimit;
  }
  const host = await fixture.client();
  const guest = await fixture.client();
  await createRoom(host);
  const rejected = await denied(guest, 'room:create', { name: 'Grace', config: CONFIG });
  assert.match(rejected.error!, /room limit/i);
  assert.equal((await send(host, 'room:leave')).ok, true);
  await createRoom(guest);
});

test('per-socket rate limiting acknowledges a burst without limiting another socket', TEST_OPTIONS, async (t) => {
  const fixture = await setup(t);
  const noisy = await fixture.client();
  const other = await fixture.client();
  const replies = await Promise.all(Array.from({ length: 41 }, () => send(noisy, 'room:leave')));
  assert.ok(replies.slice(0, 40).every((ack) => ack.ok));
  assert.equal(replies[40].ok, false);
  assert.match(replies[40].error!, /too many requests/i);
  await createRoom(other);
});

test('oversized messages disconnect their sender and clean up their active room', TEST_OPTIONS, async (t) => {
  const fixture = await setup(t);
  const host = await fixture.client();
  const guest = await fixture.client();
  const outsider = await fixture.client();
  const code = await pair(host, guest);
  const disconnected = eventLog<string>(host.socket, 'disconnect');
  const dropped = disconnected.waitFor(() => true);
  host.socket.emit('room:create', { name: 'x'.repeat(32 * 1024), config: CONFIG });
  await dropped;
  await guest.states.waitFor((state) => state.phase === 'abandoned');
  await denied(outsider, 'room:join', { name: 'Third', code });
  await createRoom(guest);
});

test('polling and WebSocket reject untrusted origins and support origin-less same-origin/native clients', TEST_OPTIONS, async (t) => {
  const fixture = await setup(t);
  for (const transport of ['polling', 'websocket'] as const) {
    const allowed = await fixture.client(transport);
    assert.ok(allowed.socket.connected);
    const noOrigin = await connect(t, fixture.url, transport, null);
    assert.ok(noOrigin.socket.connected);
    for (const origin of ['https://untrusted.example', 'null']) {
      const socket = io(fixture.url, {
        autoConnect: false, forceNew: true, reconnection: false, transports: [transport],
        extraHeaders: { Origin: origin }, timeout: EVENT_TIMEOUT,
      });
      t.after(() => { socket.disconnect(); });
      const rejected = new Promise<Error>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          socket.off('connect_error', onError);
          socket.off('connect', onConnect);
        };
        const onError = (error: Error) => { cleanup(); resolve(error); };
        const onConnect = () => { cleanup(); reject(new Error('Disallowed origin connected')); };
        const timer = setTimeout(() => { cleanup(); reject(new Error('Expected connection rejection')); }, EVENT_TIMEOUT);
        socket.once('connect_error', onError);
        socket.once('connect', onConnect);
      });
      socket.connect();
      assert.ok(await rejected);
      assert.equal(socket.connected, false);
      socket.disconnect();
    }
  }
});

test('close is idempotent and shuts down connected clients, active timers, Socket.IO and HTTP', TEST_OPTIONS, async (t) => {
  const fixture = await setup(t);
  const host = await fixture.client();
  const guest = await fixture.client();
  await pair(host, guest);
  assert.equal((await send(host, 'room:start')).ok, true);
  await host.states.waitFor((state) => state.phase === 'countdown');
  const disconnected = eventLog<string>(host.socket, 'disconnect');
  const stopped = disconnected.waitFor(() => true);
  const firstClose = fixture.server.close();
  assert.equal(fixture.server.close(), firstClose);
  await Promise.all([firstClose, stopped]);
  assert.equal(fixture.server.httpServer.listening, false);
  assert.equal(fixture.server.io.engine.clientsCount, 0);
  assert.equal(host.socket.connected, false);
  await fixture.server.close();
});