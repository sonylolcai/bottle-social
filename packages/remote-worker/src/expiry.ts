function addDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function bottleExpiry(createdAt: string): string {
  return addDays(createdAt, 3);
}

export function replyExpiry(createdAt: string): string {
  return addDays(createdAt, 7);
}

export function shouldPurgeBottleContent(input: { now: string; expiresAt: string }): boolean {
  return new Date(input.now).getTime() >= new Date(input.expiresAt).getTime();
}
