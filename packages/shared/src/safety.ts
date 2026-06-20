export type SafetyCode =
  | "TEXT_EMPTY"
  | "TEXT_TOO_LONG_OVER_1200_CHARS"
  | "CONTAINS_URL"
  | "CONTAINS_EMAIL"
  | "CONTAINS_PHONE_NUMBER"
  | "CONTAINS_EXACT_LOCATION_PATTERN"
  | "CONTAINS_PAYMENT_HANDLE"
  | "CONTAINS_HIGH_RISK_KEYWORD";

export type SafetyResult = { ok: true } | { ok: false; code: SafetyCode };

const DEFAULT_MAX_LENGTH = 1200;

const URL_PATTERN =
  /\b(?:https?:\/\/|www\.|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:com|net|org|io|co|app|dev|me|gg|tv|info|biz|edu|gov)\b)/i;

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

const PHONE_LIKE_PATTERN = /\+?\d[\d\s().-]{7,}\d/;

const EXACT_LOCATION_PATTERNS = [
  /\bmy address is\b/i,
  /\bi live at\b/i,
  /\bi am at\b/i,
  /\bcome to my house\b/i,
  /\bmeet me at\b/i,
  /\bapt\.?\s+\w+/i,
  /\bapartment\s+\w+/i,
  /\broom\s+\d+\b/i,
  /\b\d{1,6}\s+[a-z][a-z\s.'-]{1,40}\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|place|pl)\b/i
];

const PAYMENT_HANDLE_PATTERNS = [
  /\bpaypal(?:\.me)?\b/i,
  /\bcash\s*app\b/i,
  /\bcashapp\b/i,
  /\bvenmo\b/i,
  /\bzelle\b/i,
  /\b(?:venmo|cashapp|paypal|zelle)\s*(?:is|:)?\s*[@$][a-z0-9_.-]{2,}\b/i,
  /\b(?:send|pay|tip)\s+(?:me\s+)?(?:at\s+)?[@$][a-z0-9_.-]{2,}\b/i
];

const HIGH_RISK_KEYWORDS = [
  "suicide",
  "self harm",
  "self-harm",
  "kill myself",
  "kill yourself",
  "overdose",
  "bomb",
  "explosive",
  "terrorist",
  "credit card number",
  "social security number",
  "ssn",
  "password",
  "private key",
  "seed phrase"
];

function containsPhoneLikeContact(text: string): boolean {
  const match = text.match(PHONE_LIKE_PATTERN);
  if (!match) {
    return false;
  }

  const digitCount = match[0].replace(/\D/g, "").length;
  return digitCount >= 9 && digitCount <= 14;
}

export function checkTextSafety(
  text: string,
  maxLength = DEFAULT_MAX_LENGTH
): SafetyResult {
  const normalizedText = text.trim();

  if (normalizedText.length === 0) {
    return { ok: false, code: "TEXT_EMPTY" };
  }

  if (normalizedText.length > maxLength) {
    return { ok: false, code: "TEXT_TOO_LONG_OVER_1200_CHARS" };
  }

  if (EMAIL_PATTERN.test(normalizedText)) {
    return { ok: false, code: "CONTAINS_EMAIL" };
  }

  if (URL_PATTERN.test(normalizedText)) {
    return { ok: false, code: "CONTAINS_URL" };
  }

  if (containsPhoneLikeContact(normalizedText)) {
    return { ok: false, code: "CONTAINS_PHONE_NUMBER" };
  }

  if (EXACT_LOCATION_PATTERNS.some((pattern) => pattern.test(normalizedText))) {
    return { ok: false, code: "CONTAINS_EXACT_LOCATION_PATTERN" };
  }

  if (PAYMENT_HANDLE_PATTERNS.some((pattern) => pattern.test(normalizedText))) {
    return { ok: false, code: "CONTAINS_PAYMENT_HANDLE" };
  }

  const lowerText = normalizedText.toLowerCase();
  if (HIGH_RISK_KEYWORDS.some((keyword) => lowerText.includes(keyword))) {
    return { ok: false, code: "CONTAINS_HIGH_RISK_KEYWORD" };
  }

  return { ok: true };
}
