import { botDecision, COUNTDOWN_MS, makeAnswer, publicQuestion, REVEAL_MS, ROUND_MS, sanitizeName, selectQuestions } from '../shared/rules';
import type { MatchConfig, RoomState, Question, Mode } from '../shared/types';

/** Offline authority. Timestamps, not animation frames, decide whether an answer is late. */
export class LocalMatch {
  state: RoomState;
  private questions: Question[];
  private answers = new Map<string, { choice: number; elapsedMs: number }>();
  private bot: { choice: number; at: number } | null = null;
  private timer: ReturnType<typeof setInterval>;
  private listeners = new Set<(state: RoomState) => void>();
  constructor(config: MatchConfig, names: [string, string], private mode: Exclude<Mode, 'online'>, private now = Date.now) {
    this.questions = selectQuestions(config.category, config.rounds);
    this.state = {
      code: '', hostId: 'p1', config, phase: 'countdown', round: 0, startsAt: 0, deadline: 0,
      question: null, answeredIds: [], result: null, history: [],
      players: names.map((name, i) => ({ id: `p${i + 1}`, name: sanitizeName(name), score: 0, correct: 0, totalMs: 0 }))
    };
    this.countdown();
    this.timer = setInterval(() => this.tick(), 40);
  }
  subscribe(listener: (state: RoomState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private publish() { this.state = { ...this.state }; this.listeners.forEach(fn => fn(this.state)); }
  private countdown() {
    this.answers.clear(); this.bot = null;
    const opens = this.now() + COUNTDOWN_MS;
    Object.assign(this.state, { phase: 'countdown', startsAt: opens, deadline: opens, question: null, result: null, answeredIds: [] });
    this.publish();
  }
  private openQuestion() {
    const startsAt = this.now();
    Object.assign(this.state, { phase: 'question', startsAt, deadline: startsAt + ROUND_MS, question: publicQuestion(this.questions[this.state.round]) });
    if (this.mode === 'bot') { const decision = botDecision(this.questions[this.state.round], this.state.config.difficulty); this.bot = { choice: decision.choice, at: startsAt + decision.delayMs }; }
    this.publish();
  }
  submit(playerId: string, choice: number): boolean {
    if (this.state.phase !== 'question' || this.now() >= this.state.deadline || this.answers.has(playerId) || !this.state.players.some(p => p.id === playerId) || !Number.isInteger(choice) || choice < 0 || choice > 3) return false;
    this.answers.set(playerId, { choice, elapsedMs: Math.max(0, this.now() - this.state.startsAt) });
    this.state.answeredIds = [...this.answers.keys()];
    if (this.answers.size === 2) this.reveal(); else this.publish();
    return true;
  }
  private reveal() {
    const question = this.questions[this.state.round];
    const answers = this.state.players.map(player => {
      const answer = this.answers.get(player.id);
      return makeAnswer(question, player.id, answer?.choice ?? null, answer?.elapsedMs ?? ROUND_MS);
    });
    this.state.players = this.state.players.map(player => {
      const answer = answers.find(a => a.playerId === player.id)!;
      return { ...player, score: player.score + answer.points, correct: player.correct + Number(answer.correct), totalMs: player.totalMs + (answer.correct ? answer.elapsedMs : 0) };
    });
    const result = { question, answers, index: this.state.round };
    Object.assign(this.state, { phase: 'reveal', result, history: [...this.state.history, result], deadline: this.now() + REVEAL_MS });
    this.publish();
  }
  private tick() {
    const time = this.now();
    if (this.state.phase === 'countdown' && time >= this.state.startsAt) this.openQuestion();
    else if (this.state.phase === 'question') {
      if (time >= this.state.deadline) { this.reveal(); return; }
      if (this.bot && time >= this.bot.at && !this.answers.has('p2')) this.submit('p2', this.bot.choice);
    } else if (this.state.phase === 'reveal' && time >= this.state.deadline) {
      if (this.state.round + 1 >= this.state.config.rounds) { this.state.phase = 'finished'; this.publish(); clearInterval(this.timer); }
      else { this.state.round++; this.countdown(); }
    }
  }
  dispose() { clearInterval(this.timer); this.listeners.clear(); }
}