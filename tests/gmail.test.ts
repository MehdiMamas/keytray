import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeBody, GmailApiError, gmailMessageUrl, htmlToText, parseGmailMessage, pollGmail } from '~/lib/gmail';

describe('gmail parsing', () => {
  it('decodes a base64url plain-text part', () => {
    const raw = parseGmailMessage({
      id: 'm1',
      internalDate: '1700000000000',
      payload: {
        headers: [
          { name: 'Subject', value: 'Verification code' },
          { name: 'From', value: 'Google <noreply@google.com>' },
        ],
        mimeType: 'text/plain',
        body: { data: encode('Your verification code is 847291') },
      },
    });
    expect(raw.subject).toBe('Verification code');
    expect(raw.from).toContain('noreply@google.com');
    expect(raw.body).toContain('847291');
    expect(raw.html).toBe('');
    expect(raw.receivedAt).toBe(1700000000000);
  });

  it('keeps the html part when a plain part is also present', () => {
    const raw = parseGmailMessage({
      id: 'm2',
      payload: {
        headers: [{ name: 'Subject', value: 'Verify your email' }],
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: encode('Your code is 111111') } },
          {
            mimeType: 'text/html',
            body: { data: encode('<a href="https://accounts.example.com/verify?token=abc">Verify</a>') },
          },
        ],
      },
    });
    expect(raw.body).toContain('111111');
    expect(raw.html).toContain('https://accounts.example.com/verify?token=abc');
  });

  it('strips html when there is no plain part', () => {
    const text = htmlToText('<p>Your <b>code</b> is&nbsp;123456</p>');
    expect(text).toBe('Your code is 123456');
    expect(decodeBody(encode('abc'))).toBe('abc');
  });

  it('opens the message in the account that received it', () => {
    expect(gmailMessageUrl('me@gmail.com', '18abc')).toBe(
      'https://mail.google.com/mail/?authuser=me%40gmail.com#all/18abc',
    );
  });
});

describe('pollGmail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips a message Gmail no longer has and still advances history', async () => {
    vi.stubGlobal('fetch', async (input: string) => {
      const url = String(input);
      if (url.includes('/history?')) {
        return json({
          historyId: '200',
          history: [
            { messagesAdded: [{ message: { id: 'gone' } }, { message: { id: 'kept' } }] },
          ],
        });
      }
      if (url.includes('/messages/gone')) return new Response('', { status: 404 });
      if (url.includes('/messages/kept')) return json(gmailMessage('kept', 'Your code is 123456'));
      throw new Error(`unexpected ${url}`);
    });

    const result = await pollGmail('token', '100');
    expect(result.historyId).toBe('200');
    expect(result.messages.map((message) => message.id)).toEqual(['kept']);
    expect(result.messages[0]?.body).toContain('123456');
  });

  it('does not call profile when it already has a history id', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: string) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/history?')) return json({ historyId: '300' });
      throw new Error(`unexpected ${url}`);
    });

    const result = await pollGmail('token', '250');
    expect(result).toEqual({ messages: [], historyId: '300' });
    expect(calls).toHaveLength(1);
  });

  it('throws GmailApiError when Gmail returns 500', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 500 }));
    await expect(pollGmail('token', undefined)).rejects.toBeInstanceOf(GmailApiError);
  });
});

function encode(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function gmailMessage(id: string, text: string) {
  return {
    id,
    internalDate: '1700000000000',
    payload: {
      headers: [
        { name: 'Subject', value: 'Verification code' },
        { name: 'From', value: 'Google <noreply@google.com>' },
      ],
      mimeType: 'text/plain',
      body: { data: encode(text) },
    },
  };
}
