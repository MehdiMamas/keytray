const KEYWORD =
  /verification code|security code|one[- ]time|passcode|\botp\b|\bpin\b|\b2fa\b|verification|\bverify\b|\bcode\b|sign[- ]in|\blogin\b|\bconfirm/i;

const NEGATIVE_NEAR =
  /\b(order|invoice|tracking|ticket|receipt|reference|confirmation\s*#|ref)\b/i;

interface Candidate {
  code: string;
  index: number;
  inSubject: boolean;
  alphanumeric: boolean;
}

/**
 * Pull the most likely verification code out of a subject and body.
 * Returns null when the message does not look like a code email.
 */
export function extractCode(subject: string, body: string): string | null {
  const subjectText = stripUrls(subject);
  const bodyText = stripUrls(body);
  const text = `${subjectText}\n${bodyText}`;
  if (!KEYWORD.test(text)) return null;

  const subjectEnd = subjectText.length;
  const candidates: Candidate[] = [];

  const digitRe = /(?<![A-Za-z0-9])(\d{3,4}[\s-]\d{3,4}|\d{4,8})(?![A-Za-z0-9])/g;
  for (const match of text.matchAll(digitRe)) {
    const raw = match[1] ?? '';
    const code = raw.replace(/[\s-]/g, '');
    if (code.length < 4 || code.length > 8) continue;
    if (isRejectedNumber(text, match.index ?? 0, raw, code)) continue;
    candidates.push({
      code,
      index: match.index ?? 0,
      inSubject: (match.index ?? 0) <= subjectEnd,
      alphanumeric: false,
    });
  }

  const alnumRe = /(?<![A-Za-z0-9])(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{6,8}(?![A-Za-z0-9])/g;
  const hyphenAlnumRe = /(?<![A-Za-z0-9])([A-Za-z0-9]{3,4}-[A-Za-z0-9]{3,4})(?![A-Za-z0-9])/g;
  for (const match of text.matchAll(alnumRe)) {
    const code = match[0] ?? '';
    if (isRejectedNumber(text, match.index ?? 0, code, code)) continue;
    candidates.push({
      code,
      index: match.index ?? 0,
      inSubject: (match.index ?? 0) <= subjectEnd,
      alphanumeric: true,
    });
  }
  for (const match of text.matchAll(hyphenAlnumRe)) {
    const raw = match[1] ?? '';
    const code = raw.replace('-', '');

    if (!/[A-Za-z]/.test(code) || !/\d/.test(code)) continue;
    if (isRejectedNumber(text, match.index ?? 0, raw, code)) continue;

    candidates.push({
      code,
      index: match.index ?? 0,
      inSubject: (match.index ?? 0) <= subjectEnd,
      alphanumeric: true,
    });
  }
  
  let best: { code: string; score: number } | null = null;
  for (const candidate of candidates) {
    const distance = nearestKeywordDistance(text, candidate.index);
    if (distance > 160 && !candidate.inSubject) continue;
    let score = 1;
    score += Math.max(0, 80 - distance) / 20;
    if (candidate.inSubject) score += 4;
    if (candidate.code.length === 6) score += 2;
    else if (candidate.code.length === 5 || candidate.code.length === 7) score += 1;
    if (candidate.alphanumeric) score -= 0.5;
    const beforeContext = text.slice(Math.max(0, candidate.index - 32), candidate.index);
    if (NEGATIVE_NEAR.test(beforeContext)) score -= 8;
    if (!best || score > best.score) best = { code: candidate.code, score };
  }

  if (!best || best.score < 1) return null;
  return best.code;
}

function stripUrls(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, ' ');
}

function nearestKeywordDistance(text: string, index: number): number {
  let best = Infinity;
  for (const match of text.matchAll(new RegExp(KEYWORD.source, 'gi'))) {
    const at = match.index ?? 0;
    best = Math.min(best, Math.abs(at - index));
  }
  return best;
}

function isRejectedNumber(text: string, index: number, raw: string, code: string): boolean {
  const before = text.slice(Math.max(0, index - 8), index);
  const after = text.slice(index + raw.length, index + raw.length + 8);
  const window = text.slice(Math.max(0, index - 16), index + raw.length + 16);

  if (/[$€£]\s*$/.test(before)) return true;
  if (/^\s*[.,]\d/.test(after) && code.length <= 6) return true;

  if (isInsidePhoneNumber(text, index, raw, code)) return true;

  if (/[/\-.]\s*$/.test(before) || /^\s*[/\-.]/.test(after)) {
    if (/\d{1,4}\s*[/\-.]\s*\d{1,2}\s*[/\-.]\s*\d{2,4}/.test(window)) return true;
  }

  if (/^(19|20)\d{2}$/.test(code)) {
    const yearContext = /\b(year|copyright|©|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(window);
    const looksLikeDate = /\d{1,2}\s*[/\-.]\s*\d{1,2}\s*[/\-.]\s*(19|20)\d{2}/.test(window);
    if (yearContext || looksLikeDate || code.startsWith('19') || code.startsWith('20')) {
      if (!/\b(code|otp|pin)\b/i.test(window)) return true;
    }
  }

  return false;
}

function isInsidePhoneNumber(text: string, index: number, raw: string, code: string): boolean {
  const from = Math.max(0, index - 24);
  const slice = text.slice(from, index + raw.length + 24);
  for (const match of slice.matchAll(/\+?\d[\d\s().-]{8,}\d/g)) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length < 10 || digits === code) continue;
    const start = from + (match.index ?? 0);
    const end = start + match[0].length;
    if (index >= start && index < end) return true;
  }
  return false;
}
