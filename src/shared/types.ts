export type Category = 'general' | 'puzzles' | 'reasoning';
export type CategorySelection = Category | 'mixed';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type Mode = 'bot' | 'local' | 'online';
export interface Question {
  id: string; category: Category; difficulty: Difficulty; prompt: string;
  options: [string, string, string, string]; correct: number; explanation: string;
}
export type PublicQuestion = Omit<Question, 'correct' | 'explanation'>;
export interface MatchConfig { category: CategorySelection; rounds: 5 | 10 | 15; difficulty: Difficulty }
export interface Player { id: string; name: string; score: number; correct: number; totalMs: number }
export interface AnswerResult { playerId: string; choice: number | null; elapsedMs: number; correct: boolean; points: number }
export interface RoundResult { question: Question; answers: AnswerResult[]; index: number }
export type MatchPhase = 'lobby' | 'countdown' | 'question' | 'reveal' | 'finished' | 'abandoned';
export interface RoomState {
  code: string; hostId: string; config: MatchConfig; phase: MatchPhase;
  players: Player[]; round: number; startsAt: number; deadline: number;
  question: PublicQuestion | null; answeredIds: string[];
  result: RoundResult | null; history: RoundResult[]; message?: string;
}
export interface Ack { ok: boolean; error?: string; code?: string; playerId?: string }