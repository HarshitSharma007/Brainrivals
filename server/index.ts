import { randomInt } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { Server, type Socket } from 'socket.io';
import sirv from 'sirv';
import {
  COUNTDOWN_MS,
  REVEAL_MS,
  ROUND_MS,
  makeAnswer,
  publicQuestion,
  sanitizeName,
  selectQuestions,
  validateConfig,
} from '../src/shared/rules.js';
import type { Ack, Question, RoomState, RoundResult } from '../src/shared/types.js';

type Reply = (ack: Ack) => void;
interface ClientEvents {
  'room:create': (payload: unknown, ack?: Reply) => void;
  'room:join': (payload: unknown, ack?: Reply) => void;
  'room:start': (ack?: Reply) => void;
  'round:answer': (payload: unknown, ack?: Reply) => void;
  'room:leave': (ack?: Reply) => void;
}
interface ServerEvents {
  'room:state': (state: RoomState) => void;
  'server:time': (now: number) => void;
  'room:closed': (reason: string) => void;
}
interface SocketData { roomCode?: string }
type GameSocket = Socket<ClientEvents, ServerEvents, Record<string, never>, SocketData>;
interface Room {
  state: RoomState;
  questions: Question[];
  submissions: Map<string, { choice: number; elapsedMs: number }>;
  timer?: ReturnType<typeof setTimeout>;
}

export interface GameServerOptions {
  port?: number;
  host?: string;
  origins?: string[];
  roundMs?: number;
  revealMs?: number;
  countdownMs?: number;
  roomTtlMs?: number;
  staticDir?: string | false;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
];
const RATE_WINDOW_MS = 10_000;
const RATE_LIMIT = 40;
const MAX_MESSAGE_BYTES = 16 * 1024;

function integer(value: number, name: string, min: number, max = 2_147_483_647): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function reply(callback: unknown, ack: Ack): void {
  if (typeof callback === 'function') callback(ack);
}

function allowedOrigins(values: string[]): Set<string> {
  if (values.length === 0) throw new Error('At least one explicit origin is required.');
  return new Set(values.map((value) => {
    const origin = value.trim().replace(/\/$/, '');
    const parsed = new URL(origin);
    if (!['http:', 'https:', 'capacitor:'].includes(parsed.protocol)
      || !parsed.hostname || parsed.hostname.includes('*')
      || origin !== `${parsed.protocol}//${parsed.host}`) {
      throw new Error('Allowed origins must be explicit origins without paths or wildcards.');
    }
    return origin;
  }));
}

/**
 * In-memory, single-process authority. Importing this module never opens a port.
 * ALLOWED_ORIGINS is comma-separated; MAX_ROOMS (default 1000) bounds live rooms.
 * Supplied Origins must be allowlisted. Missing Origin is allowed for same-origin
 * polling/native clients; this browser-origin policy is not client authentication.
 * round/result.index are zero-based. Countdown startsAt/deadline mark question opening;
 * question and reveal deadlines mark the ends of those phases. Idle times are zero.
 * Timing overrides do not change the shared scoring formula or its ROUND_MS window.
 */
export async function createGameServer(opts: GameServerOptions = {}) {
  const port = integer(opts.port ?? Number(process.env.PORT ?? 3001), 'PORT', 0, 65_535);
  const host = opts.host ?? '0.0.0.0';
  const roundMs = integer(opts.roundMs ?? ROUND_MS, 'roundMs', 1);
  const revealMs = integer(opts.revealMs ?? REVEAL_MS, 'revealMs', 1);
  const countdownMs = integer(opts.countdownMs ?? COUNTDOWN_MS, 'countdownMs', 1);
  const roomTtlMs = integer(opts.roomTtlMs ?? 15 * 60_000, 'roomTtlMs', 1);
  const maxRooms = integer(Number(process.env.MAX_ROOMS ?? 1000), 'MAX_ROOMS', 1);
  const origins = allowedOrigins(opts.origins ?? [
    ...(process.env.ALLOWED_ORIGINS === undefined ? DEFAULT_ORIGINS : process.env.ALLOWED_ORIGINS.split(',')),
    ...[process.env.RENDER_EXTERNAL_URL, process.env.PUBLIC_ORIGIN].filter((value): value is string => !!value),
  ]);
  const acceptsOrigin = (origin: string | undefined) => origin === undefined || origins.has(origin);
  const rooms = new Map<string, Room>();
  let shuttingDown = false;
  const staticDir = opts.staticDir ?? (process.env.SERVE_WEB === '1' ? resolve('dist') : undefined);
  if (staticDir && !existsSync(resolve(staticDir, 'index.html'))) throw new Error('Build the web app before starting with SERVE_WEB=1.');
  const serveWeb = staticDir ? sirv(staticDir, {
    etag: true, maxAge: 0, dotfiles: false, extensions: ['html'],
    setHeaders: response => { response.setHeader('Cache-Control', 'no-cache'); },
  }) : undefined;

  const httpServer = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    const notFound = () => {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.writeHead(404);
      response.end(JSON.stringify({ error: 'Not found' }));
    };
    if (request.method === 'GET' && request.url?.split('?')[0] === '/health') {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.writeHead(shuttingDown ? 503 : 200);
      response.end(JSON.stringify({ ok: !shuttingDown }));
    } else if (serveWeb && (request.method === 'GET' || request.method === 'HEAD')) serveWeb(request, response, notFound);
    else notFound();
  });
  const io = new Server<ClientEvents, ServerEvents, Record<string, never>, SocketData>(httpServer, {
    serveClient: false,
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
    cors: { origin: [...origins], methods: ['GET', 'POST'] },
    // Unlike CORS alone, this also rejects direct WebSocket handshakes.
    allowRequest: (request, accept) => {
      accept(null, acceptsOrigin(request.headers.origin));
    },
  });
  // Check subsequent polling requests and WebSocket upgrades as well as handshakes.
  io.engine.use((request: IncomingMessage, _response: ServerResponse, next: (error?: Error) => void) => {
    next(acceptsOrigin(request.headers.origin) ? undefined : new Error('Origin not allowed'));
  });

  function clearTimer(room: Room): void {
    if (room.timer !== undefined) clearTimeout(room.timer);
    room.timer = undefined;
  }

  function arm(room: Room, delay: number, action: () => void): void {
    clearTimer(room);
    room.timer = setTimeout(() => {
      room.timer = undefined;
      if (!shuttingDown && rooms.get(room.state.code) === room) action();
    }, Math.max(0, delay));
    room.timer.unref();
  }

  function broadcast(room: Room): void {
    io.to(room.state.code).emit('server:time', Date.now());
    // Only public questions and already-revealed results ever enter RoomState.
    io.to(room.state.code).emit('room:state', room.state);
  }

  function dispose(room: Room, message: string): void {
    clearTimer(room);
    room.state.phase = 'abandoned';
    room.state.startsAt = 0;
    room.state.deadline = 0;
    room.state.question = null;
    room.state.answeredIds = [];
    room.state.message = message;
    broadcast(room);
    io.to(room.state.code).emit('room:closed', message);
    // Notify first, then invalidate both membership and the code. No reconnection grace period.
    rooms.delete(room.state.code);
    for (const player of room.state.players) {
      const member = io.sockets.sockets.get(player.id);
      if (member?.data.roomCode === room.state.code) delete member.data.roomCode;
    }
    io.in(room.state.code).socketsLeave(room.state.code);
    room.questions = [];
    room.submissions.clear();
  }

  function waitForPlayers(room: Room): void {
    arm(room, roomTtlMs, () => dispose(room, 'This inactive room expired. Create a new room.'));
  }

  function membership(socket: GameSocket): Room | undefined {
    const room = socket.data.roomCode ? rooms.get(socket.data.roomCode) : undefined;
    return room?.state.players.some((player) => player.id === socket.id) ? room : undefined;
  }

  function leave(socket: GameSocket): void {
    const room = membership(socket);
    delete socket.data.roomCode;
    if (!room) return;
    void socket.leave(room.state.code);
    room.state.players = room.state.players.filter((player) => player.id !== socket.id);
    dispose(room, 'The other player left. Create or join a new room.');
  }

  function finish(room: Room): void {
    room.state.phase = 'finished';
    room.state.startsAt = 0;
    room.state.deadline = 0;
    room.questions = [];
    room.submissions.clear();
    waitForPlayers(room);
    broadcast(room);
  }

  function reveal(room: Room): void {
    if (room.state.phase !== 'question') return;
    clearTimer(room);
    const question = room.questions[room.state.round];
    const answers = room.state.players.map((player) => {
      const submission = room.submissions.get(player.id);
      return makeAnswer(question, player.id, submission?.choice ?? null, submission?.elapsedMs ?? roundMs);
    });
    // This is the only scoring site; the phase guard makes timeout/last-answer races idempotent.
    for (const player of room.state.players) {
      const answer = answers.find((entry) => entry.playerId === player.id)!;
      player.score += answer.points;
      if (answer.correct) {
        player.correct += 1;
        player.totalMs += answer.elapsedMs;
      }
    }
    const result: RoundResult = { question, answers, index: room.state.round };
    room.state.history = [...room.state.history.filter((entry) => entry.index !== result.index), result];
    room.state.result = result;
    room.state.phase = 'reveal';
    room.state.startsAt = Date.now();
    room.state.deadline = room.state.startsAt + revealMs;
    room.submissions.clear();
    arm(room, revealMs, () => {
      if (room.state.round + 1 === room.questions.length) finish(room);
      else countdown(room, room.state.round + 1);
    });
    broadcast(room);
  }

  function openQuestion(room: Room): void {
    room.state.phase = 'question';
    room.state.startsAt = Date.now();
    room.state.deadline = room.state.startsAt + roundMs;
    room.state.question = publicQuestion(room.questions[room.state.round]);
    arm(room, roundMs, () => reveal(room));
    broadcast(room);
  }

  function countdown(room: Room, index: number): void {
    room.submissions.clear();
    room.state.phase = 'countdown';
    room.state.round = index;
    room.state.startsAt = Date.now() + countdownMs;
    room.state.deadline = room.state.startsAt;
    room.state.question = null;
    room.state.answeredIds = [];
    room.state.result = null;
    arm(room, countdownMs, () => openQuestion(room));
    broadcast(room);
  }

  io.on('connection', (socket) => {
    let windowStart = Date.now();
    let messages = 0;
    socket.emit('server:time', Date.now());
    socket.use((packet, next) => {
      const now = Date.now();
      if (now - windowStart >= RATE_WINDOW_MS) { windowStart = now; messages = 0; }
      if (shuttingDown || ++messages > RATE_LIMIT) {
        reply(packet[packet.length - 1], {
          ok: false,
          error: shuttingDown ? 'Server is shutting down.' : 'Too many requests. Please slow down.',
        });
        return;
      }
      next();
    });

    socket.on('room:create', (payload, ack) => {
      if (socket.data.roomCode) return reply(ack, { ok: false, error: 'Leave your current room first.' });
      if (rooms.size >= maxRooms) return reply(ack, { ok: false, error: 'Server room limit reached. Try again later.' });
      if (!record(payload) || typeof payload.name !== 'string' || !record(payload.config)) {
        return reply(ack, { ok: false, error: 'A name and match configuration are required.' });
      }
      try {
        const name = sanitizeName(payload.name);
        const config = validateConfig(payload.config);
        if (!name || !config) return reply(ack, { ok: false, error: 'Invalid name or match configuration.' });
        let code: string;
        do {
          code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
        } while (rooms.has(code));
        const room: Room = {
          state: {
            code, hostId: socket.id, config, phase: 'lobby',
            players: [{ id: socket.id, name, score: 0, correct: 0, totalMs: 0 }],
            round: 0, startsAt: 0, deadline: 0, question: null,
            answeredIds: [], result: null, history: [],
          },
          questions: [],
          submissions: new Map(),
        };
        rooms.set(code, room);
        socket.data.roomCode = code;
        void socket.join(code);
        waitForPlayers(room);
        broadcast(room);
        reply(ack, { ok: true, code, playerId: socket.id });
      } catch {
        reply(ack, { ok: false, error: 'Invalid name or match configuration.' });
      }
    });

    socket.on('room:join', (payload, ack) => {
      if (socket.data.roomCode) return reply(ack, { ok: false, error: 'Leave your current room first.' });
      if (!record(payload) || typeof payload.code !== 'string' || typeof payload.name !== 'string') {
        return reply(ack, { ok: false, error: 'A name and six-character room code are required.' });
      }
      const code = payload.code.trim().toUpperCase();
      const room = CODE_PATTERN.test(code) ? rooms.get(code) : undefined;
      if (!room) return reply(ack, { ok: false, error: 'Room not found or expired.' });
      if (room.state.players.length >= 2) return reply(ack, { ok: false, error: 'Room is full (two players maximum).' });
      if (room.state.phase !== 'lobby') return reply(ack, { ok: false, error: 'This room has already started.' });
      const name = sanitizeName(payload.name);
      if (!name) return reply(ack, { ok: false, error: 'Invalid player name.' });
      room.state.players.push({ id: socket.id, name, score: 0, correct: 0, totalMs: 0 });
      socket.data.roomCode = code;
      void socket.join(code);
      waitForPlayers(room);
      broadcast(room);
      reply(ack, { ok: true, code, playerId: socket.id });
    });

    socket.on('room:start', (ack) => {
      const room = membership(socket);
      if (!room) return reply(ack, { ok: false, error: 'Join a room first.' });
      if (room.state.hostId !== socket.id) return reply(ack, { ok: false, error: 'Only the host can start a match.' });
      if (!['lobby', 'finished'].includes(room.state.phase)) {
        return reply(ack, { ok: false, error: 'A match is already in progress.' });
      }
      if (room.state.players.length !== 2) return reply(ack, { ok: false, error: 'Two players are required.' });
      try {
        const questions = selectQuestions(room.state.config.category, room.state.config.rounds);
        if (questions.length !== room.state.config.rounds) throw new Error('Not enough questions');
        room.questions = [...questions];
      } catch {
        return reply(ack, { ok: false, error: 'Unable to select questions for this match.' });
      }
      room.state.players = room.state.players.map((player) => ({ ...player, score: 0, correct: 0, totalMs: 0 }));
      room.state.history = [];
      delete room.state.message;
      countdown(room, 0);
      reply(ack, { ok: true });
    });

    socket.on('round:answer', (payload, ack) => {
      // Capture arrival before validation; never accept client timestamps, scores, or identities.
      const receivedAt = Date.now();
      const room = membership(socket);
      if (!room) return reply(ack, { ok: false, error: 'Join a room first.' });
      if (room.state.phase !== 'question') return reply(ack, { ok: false, error: 'Answers are not open.' });
      if (receivedAt >= room.state.deadline) {
        reveal(room);
        return reply(ack, { ok: false, error: 'The answer deadline has passed.' });
      }
      const question = room.questions[room.state.round];
      if (!record(payload) || payload.questionId !== question.id
        || typeof payload.choice !== 'number' || !Number.isInteger(payload.choice)
        || payload.choice < 0 || payload.choice > 3) {
        return reply(ack, { ok: false, error: 'Use the current question ID and an integer choice from 0 to 3.' });
      }
      if (room.submissions.has(socket.id)) return reply(ack, { ok: false, error: 'You already answered this question.' });
      room.submissions.set(socket.id, {
        choice: payload.choice,
        elapsedMs: Math.max(0, receivedAt - room.state.startsAt),
      });
      room.state.answeredIds = [...room.submissions.keys()];
      if (room.submissions.size === 2) reveal(room);
      else broadcast(room);
      reply(ack, { ok: true });
    });

    socket.on('room:leave', (ack) => { leave(socket); reply(ack, { ok: true }); });
    socket.on('disconnect', () => leave(socket));
  });

  let closePromise: Promise<void> | undefined;
  function close(): Promise<void> {
    if (closePromise) return closePromise;
    shuttingDown = true;
    for (const room of rooms.values()) dispose(room, 'The server is shutting down.');
    closePromise = new Promise<void>((resolve, reject) => {
      io.close((error?: Error) => {
        if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
          reject(error);
        } else if (httpServer.listening) {
          httpServer.close((httpError) => httpError ? reject(httpError) : resolve());
        } else resolve();
      });
      httpServer.closeIdleConnections();
    });
    return closePromise;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => { httpServer.off('listening', onListening); reject(error); };
      const onListening = () => { httpServer.off('error', onError); resolve(); };
      httpServer.once('error', onError);
      httpServer.once('listening', onListening);
      httpServer.listen(port, host);
    });
  } catch (error) {
    await close();
    throw error;
  }
  return { httpServer, io, port: (httpServer.address() as AddressInfo).port, close };
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  void createGameServer().then((server) => {
    console.log(`BrainRivals server listening on port ${server.port}.`);
    const shutdown = () => {
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      void server.close().catch(() => {
        console.error('BrainRivals server could not close cleanly.');
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }).catch(() => {
    console.error('BrainRivals server could not start. Check the port and server configuration.');
    process.exitCode = 1;
  });
}