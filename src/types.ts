export interface QuizItemRaw {
  id: number | string;
  question: string;
  answer: string;
}

export interface QuizItem {
  id: string;
  question: string;
  answer: string;
}

export type GameStatus = 'idle' | 'playing' | 'finished';
export type CardVisualState = 'normal' | 'selected' | 'correct' | 'wrong';

export interface WrongPairState {
  leftId: string;
  rightId: string;
}
