export type QuizAnswers = {
  detailEnjoyment: number;
  calmPreference: number;
  warmReplyComfort: number;
  reflectivePreference: number;
  thoughtfulMessagePreference: number;
};

const clampScore = (value: number): number => Math.min(5, Math.max(1, Math.round(value)));
const inverse = (value: number): number => 6 - clampScore(value);

export const personalityFromQuiz = (answers: QuizAnswers) => ({
  openness: clampScore(answers.detailEnjoyment),
  energy: inverse(answers.calmPreference),
  warmth: clampScore(answers.warmReplyComfort),
  curiosity: clampScore(answers.reflectivePreference),
  pace: inverse(answers.thoughtfulMessagePreference),
});
