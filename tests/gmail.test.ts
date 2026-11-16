import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeBody, dmarcResult, GmailApiError, gmailMessageUrl, htmlToText, parseGmailMessage, pollGmail } from '~/lib/gmail';

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

  it('reads the first Authentication-Results header for the DMARC verdict', () => {
    const mk = (values: string[]) =>
      parseGmailMessage({
        id: 'd',
        payload: {
          headers: values.map((value) => ({ name: 'Authentication-Results', value })),
          mimeType: 'text/plain',
          body: { data: encode('x') },
        },
      }).dmarc;
    expect(mk(['mx.google.com; dmarc=pass (p=NONE) header.from=a.com', 'x; dmarc=fail'])).toBe('pass');
    expect(mk(['mx.google.com; spf=pass; dmarc=fail (p=REJECT)'])).toBe('fail');
    expect(mk(['mx.google.com; spf=pass'])).toBeUndefined();
  });

  it('keeps the header.from domain Gmail evaluated, and needs exactly one', () => {
    expect(dmarcResult('mx.google.com; dmarc=pass (p=REJECT) header.from=GitHub.com')).toEqual({ dmarc: 'pass', dmarcFrom: 'github.com' });
    expect(dmarcResult('mx.google.com; dmarc=pass (p=NONE)')).toEqual({});
    expect(dmarcResult('mx.google.com; dmarc=pass header.from=a.com; dmarc=pass header.from=b.com')).toEqual({});
    expect(dmarcResult('mx.google.com; dmarc=pass header.from=xn--bcher-kva.example')).toEqual({ dmarc: 'pass', dmarcFrom: 'xn--bcher-kva.example' });
    expect(dmarcResult('mx.google.com; spf=pass smtp.mailfrom="a\\"b"; dmarc=pass header.from=a.com')).toEqual({});
  });

  it('only trusts a dmarc result that starts a method segment of Gmail header', () => {
    expect(dmarcResult('mx.google.com; dkim=pass header.i=@github.com; spf=pass; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=github.com').dmarc).toBe('pass');
    expect(dmarcResult('mx.google.com;\r\n       dmarc=pass (p=NONE) header.from=a.com').dmarc).toBe('pass');
    // Sender-chosen text echoed in a comment or a property value does not count.
    expect(dmarcResult('mx.google.com; spf=pass (google.com: domain of dmarc=pass@evil.test designates 1.2.3.4) smtp.mailfrom=dmarc=pass@evil.test').dmarc).toBeUndefined();
    expect(dmarcResult('mx.google.com; spf=pass smtp.mailfrom="x;dmarc=pass"@evil.test').dmarc).toBeUndefined();
    expect(dmarcResult('mx.google.com; spf=pass (a (nested; dmarc=pass) b) smtp.mailfrom=x@evil.test').dmarc).toBeUndefined();
    expect(dmarcResult('mx.google.com; spf=pass (unclosed; dmarc=pass').dmarc).toBeUndefined();
    // Another server's header, or no header.
    expect(dmarcResult('evil.test; dmarc=pass').dmarc).toBeUndefined();
    expect(dmarcResult('').dmarc).toBeUndefined();
    expect(dmarcResult('mx.google.com; dmarc=fail (p=REJECT) header.from=a.com').dmarc).toBe('fail');
    expect(dmarcResult('mx.google.com; dmarc=none header.from=a.com').dmarc).toBeUndefined();
    expect(dmarcResult('mx.google.com; spf=pass smtp.mailfrom=a;dmarc=pass@e.test').dmarc).toBeUndefined();
    expect(dmarcResult('mx.google.com 1; dmarc=pass header.from=a.com').dmarc).toBeUndefined();
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

  it('first sync only lists inbox mail from the last day', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: string) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/profile')) return json({ historyId: '1' });
      if (url.includes('/messages?')) return json({});
      throw new Error(`unexpected ${url}`);
    });
    await pollGmail('token', undefined);
    expect(decodeURIComponent(calls.find((url) => url.includes('/messages?')) ?? '')).toContain('q=in:inbox newer_than:1d');
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
