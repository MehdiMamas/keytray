export class AuthError extends Error {
  constructor() {
    super('Gmail rejected the access token');
    this.name = 'AuthError';
  }
}

export class HistoryExpiredError extends Error {
  constructor() {
    super('Gmail history id is too old');
    this.name = 'HistoryExpiredError';
  }
}

export class GmailApiError extends Error {
  status: number;

  constructor(status: number) {
    super(`Gmail API ${status}`);
    this.name = 'GmailApiError';
    this.status = status;
  }
}

export interface ParsedMessage {
  id: string;
  from: string;
  subject: string;
  /** Plain text, or HTML converted to text when the message has no plain part. */
  body: string;
  /** Raw HTML part, kept so verification buttons can be read from hrefs. */
  html: string;
  receivedAt: number;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
  headers?: GmailHeader[];
}

interface GmailMessage {
  id: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
}

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Open this message in the mailbox that received it, not the browser's first Google account. */
export function gmailMessageUrl(email: string, messageId: string): string {
  const params = new URLSearchParams({ authuser: email });
  return `https://mail.google.com/mail/?${params.toString()}#all/${encodeURIComponent(messageId)}`;
}

export async function pollGmail(
  token: string,
  historyId: string | undefined,
): Promise<{ messages: ParsedMessage[]; historyId: string }> {
  const profile = await gmailGet<{ historyId: string }>(token, 'profile');
  const freshHistoryId = String(profile.historyId);

  if (!historyId) {
    const messages = await listRecent(token);
    return { messages, historyId: freshHistoryId };
  }

  try {
    const ids = await listHistory(token, historyId);
    const messages: ParsedMessage[] = [];
    for (const id of ids.slice(0, 20)) {
      const message = await getMessage(token, id);
      if (message) messages.push(message);
    }
    return { messages, historyId: freshHistoryId };
  } catch (error) {
    if (!(error instanceof HistoryExpiredError)) throw error;
    const messages = await listRecent(token);
    return { messages, historyId: freshHistoryId };
  }
}

async function listRecent(token: string): Promise<ParsedMessage[]> {
  const listed = await gmailGet<{ messages?: { id: string }[] }>(
    token,
    'messages?q=newer_than:1d&maxResults=15',
  );
  const messages: ParsedMessage[] = [];
  for (const item of listed.messages ?? []) {
    const message = await getMessage(token, item.id);
    if (message) messages.push(message);
  }
  return messages;
}

async function listHistory(token: string, startHistoryId: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams({
      startHistoryId,
      historyTypes: 'messageAdded',
      labelId: 'INBOX',
    });
    if (pageToken) query.set('pageToken', pageToken);
    const page = await gmailGet<{
      history?: { messagesAdded?: { message?: { id?: string } }[] }[];
      nextPageToken?: string;
    }>(token, `history?${query.toString()}`);
    for (const entry of page.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        if (added.message?.id) ids.push(added.message.id);
      }
    }
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return ids;
}

async function getMessage(token: string, id: string): Promise<ParsedMessage | null> {
  try {
    const raw = await gmailGet<GmailMessage>(token, `messages/${id}?format=full`);
    return parseGmailMessage(raw);
  } catch (error) {
    if (error instanceof GmailApiError && error.status === 404) return null;
    throw error;
  }
}

export function parseGmailMessage(raw: GmailMessage): ParsedMessage {
  const headers = raw.payload?.headers ?? [];
  const subject = header(headers, 'Subject');
  const from = header(headers, 'From');
  const plain = findPart(raw.payload, 'text/plain');
  const htmlPart = findPart(raw.payload, 'text/html');
  const html = htmlPart ? decodeBody(htmlPart) : '';
  const body = plain ? decodeBody(plain) : html ? htmlToText(html) : raw.snippet ?? '';
  const receivedAt = raw.internalDate ? Number(raw.internalDate) : Date.parse(header(headers, 'Date')) || Date.now();
  return { id: raw.id, from, subject, body, html, receivedAt };
}

function header(headers: GmailHeader[], name: string): string {
  return headers.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function findPart(part: GmailPart | undefined, mime: string): string | undefined {
  if (!part) return undefined;
  if (part.mimeType === mime && part.body?.data) return part.body.data;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mime);
    if (found) return found;
  }
  return undefined;
}

export function decodeBody(data: string): string {
  const padded = data.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, value: string) => String.fromCharCode(Number(value)))
    .replace(/\s+/g, ' ')
    .trim();
}

async function gmailGet<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`${GMAIL}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) throw new AuthError();
  if (response.status === 404 && path.startsWith('history')) throw new HistoryExpiredError();
  if (!response.ok) throw new GmailApiError(response.status);
  return (await response.json()) as T;
}
