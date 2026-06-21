export type CandidateUser = {
  id: string;
  language: string;
  status: "active" | "suspended";
};

export function selectRecipients(input: {
  senderId: string;
  bottleLanguage: string;
  candidates: CandidateUser[];
  limit: number;
}): string[] {
  return input.candidates
    .filter((candidate) => candidate.id !== input.senderId)
    .filter((candidate) => candidate.status === "active")
    .filter((candidate) => candidate.language === input.bottleLanguage)
    .map((candidate) => candidate.id)
    .sort()
    .slice(0, Math.max(0, input.limit));
}
