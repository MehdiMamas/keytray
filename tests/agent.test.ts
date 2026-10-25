import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_ALLOWLIST,
  LOG_MAX,
  RateLimiter,
  appendLog,
  isAllowedUrl,
  runAgentCommand,
  sanitizeReply,
  type AgentDeps,
  type AgentLogEntry,
} from '~/lib/agent';
import type { CodeEntry } from '~/lib/types';

describe('isAllowedUrl', () => {
  it('matches exact host and subdomains', () => {
    expect(isAllowedUrl('https://github.com/login', DEFAULT_AGENT_ALLOWLIST)).toBe(true);
    expect(isAllowedUrl('https://accounts.google.com/x', DEFAULT_AGENT_ALLOWLIST)).toBe(true);
  });
  it('rejects look-alikes, http and junk', () => {
    expect(isAllowedUrl('https://evilgoogle.com', ['google.com'])).toBe(false);
    expect(isAllowedUrl('https://google.com.evil.io', ['google.com'])).toBe(false);
    expect(isAllowedUrl('http://google.com', ['google.com'])).toBe(false);
    expect(isAllowedUrl('not a url', ['google.com'])).toBe(false);
    expect(isAllowedUrl('https://google.com', [])).toBe(false);
  });
  it('tolerates messy allowlist entries', () => {
    expect(isAllowedUrl('https://a.github.com', [' *.GitHub.com ', ''])).toBe(true);
  });
});

describe('RateLimiter', () => {
  it('allows 10 per rolling 10 minutes', () => {
    const rl = new RateLimiter();
    for (let i = 0; i < 10; i++) expect(rl.take(1000 + i)).toBe(true);
    expect(rl.take(2000)).toBe(false);
    expect(rl.remaining(2000)).toBe(0);
    expect(rl.take(1000 + 10 * 60 * 1000)).toBe(true);
  });
});

describe('log and sanitizeReply', () => {
  it('caps the log at 200 entries, keeping the newest', () => {
    let log: AgentLogEntry[] = [];
    for (let i = 0; i < 250; i++) log = appendLog(log, { time: i, command: 'x', host: 'h', result: 'ok' });
    expect(log).toHaveLength(LOG_MAX);
    expect(log[0].time).toBe(50);
    expect(log[199].time).toBe(249);
  });
  it('drops secret keys recursively, case-insensitively', () => {
    const out = sanitizeReply({
      ok: true,
      Code: '1',
      nested: { URL: 'u', fine: 1, list: [{ otp: '2', keep: 'y' }] },
      Password: 'p',
      token: 't',
      secret: 's',
      link: 'l',
    });
    expect(out).toEqual({ ok: true, nested: { fine: 1, list: [{ keep: 'y' }] } });
  });
});

const NOW = 1_700_000_000_000;

function entry(over: Partial<CodeEntry> = {}): CodeEntry {
  return {
    id: 'a:1',
    messageId: '1',
    account: 'a',
    code: '123456',
    from: 'GitHub <noreply@github.com>',
    subject: 's',
    receivedAt: NOW - 30_000,
    kind: 'code',
    ...over,
  };
}

function makeDeps(opts: {
  enabled?: boolean;
  tabUrl?: string | null;
  entries?: CodeEntry[];
  fillResult?: boolean;
  onPoll?: () => void;
} = {}) {
  let t = NOW;
  const calls = { fill: [] as string[], nav: [] as string[], polls: 0, frameChecks: [] as boolean[] };
  const used = new Set<string>();
  const log: AgentLogEntry[] = [];
  const entries = opts.entries ?? [entry()];
  const deps: AgentDeps = {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    getConfig: async () => ({ enabled: opts.enabled ?? true, allowlist: DEFAULT_AGENT_ALLOWLIST }),
    getTabUrl: async () => (opts.tabUrl === undefined ? 'https://github.com/sessions/two-factor' : opts.tabUrl),
    hasCodeField: async () => true,
    getEntries: async () => entries,
    getUsed: async () => used,
    markUsed: async (id) => {
      used.add(id);
    },
    fill: async (_tab, code, allowed) => {
      calls.frameChecks.push(allowed('https://github.com/x'), allowed('https://evil.com/x'));
      calls.fill.push(code);
      return opts.fillResult ?? true;
    },
    navigate: async (_tab, url) => {
      calls.nav.push(url);
    },
    poll: async () => {
      calls.polls++;
      opts.onPoll?.();
    },
    limiter: new RateLimiter(),
    addLog: async (e) => {
      log.push(e);
    },
  };
  return { deps, calls, used, log, entries, advance: (ms: number) => (t += ms) };
}

describe('runAgentCommand', () => {
  it('is off by default: only status answers', async () => {
    const { deps, calls } = makeDeps({ enabled: false });
    expect((await runAgentCommand({ command: 'status' }, deps)).enabled).toBe(false);
    for (const command of ['pending', 'fill_code', 'open_link']) {
      const r = await runAgentCommand({ command, args: [1] }, deps);
      expect(r).toMatchObject({ ok: false, error: 'agent sign-in is off' });
    }
    expect(calls.fill).toHaveLength(0);
  });

  it('fills the newest code once, never returns it, marks it used', async () => {
    const { deps, calls, used, log } = makeDeps();
    const r = await runAgentCommand({ command: 'fill_code', args: [5] }, deps);
    expect(r).toMatchObject({ ok: true, filled: true });
    expect(JSON.stringify(r)).not.toContain('123456');
    expect(calls.fill).toEqual(['123456']);
    expect(calls.frameChecks).toEqual([true, false]);
    expect(used.has('a:1')).toBe(true);
    expect(JSON.stringify(log)).not.toContain('123456');
    const again = await runAgentCommand({ command: 'fill_code', args: [5] }, deps);
    expect(again).toMatchObject({ ok: false, error: 'no fresh code' });
    expect(calls.fill).toHaveLength(1);
  });

  it('ignores codes older than 10 minutes', async () => {
    const { deps } = makeDeps({ entries: [entry({ receivedAt: NOW - 11 * 60_000 })] });
    expect(await runAgentCommand({ command: 'fill_code', args: [5] }, deps)).toMatchObject({ ok: false });
  });

  it('refuses a non-allowlisted tab', async () => {
    const { deps, calls } = makeDeps({ tabUrl: 'https://evilgoogle.com/login' });
    const r = await runAgentCommand({ command: 'fill_code', args: [5] }, deps);
    expect(r).toMatchObject({ ok: false, error: 'site is not allowlisted' });
    expect(calls.fill).toHaveLength(0);
  });

  it('does not mark used when nothing was filled', async () => {
    const { deps, used } = makeDeps({ fillResult: false });
    expect(await runAgentCommand({ command: 'fill_code', args: [5] }, deps)).toMatchObject({ ok: false });
    expect(used.size).toBe(0);
  });

  it('waits by polling until a code shows up', async () => {
    const h = makeDeps({ entries: [] });
    h.deps.getEntries = async () => (h.calls.polls >= 2 ? [entry({ receivedAt: h.deps.now() })] : []);
    const r = await runAgentCommand({ command: 'fill_code', args: [5, 60] }, h.deps);
    expect(r).toMatchObject({ ok: true, filled: true });
    expect(h.calls.polls).toBe(2);
  });

  it('times out when no code arrives, and caps the wait at 120 s', async () => {
    const h = makeDeps({ entries: [] });
    const r = await runAgentCommand({ command: 'fill_code', args: [5, 9999] }, h.deps);
    expect(r).toMatchObject({ ok: false, error: 'timed out waiting for a code' });
    expect(h.deps.now() - NOW).toBeLessThanOrEqual(120_000);
    expect(h.deps.now() - NOW).toBeGreaterThanOrEqual(120_000);
    expect(h.calls.polls).toBeGreaterThan(10);
  });

  it('open_link navigates only to an allowlisted link host', async () => {
    const good = makeDeps({ entries: [entry({ kind: 'link', url: 'https://github.com/verify?t=secret' })] });
    const r = await runAgentCommand({ command: 'open_link', args: [5] }, good.deps);
    expect(r).toMatchObject({ ok: true, opened: true });
    expect(JSON.stringify(r)).not.toContain('secret');
    expect(good.calls.nav).toEqual(['https://github.com/verify?t=secret']);

    const bad = makeDeps({ entries: [entry({ kind: 'link', url: 'https://evil.com/verify' })] });
    expect(await runAgentCommand({ command: 'open_link', args: [5] }, bad.deps)).toMatchObject({
      ok: false,
      error: 'link site is not allowlisted',
    });
    expect(bad.calls.nav).toHaveLength(0);
  });

  it('pending reports availability without digits or URL', async () => {
    const h = makeDeps({ entries: [entry({ url: 'https://github.com/v?t=zzz' })] });
    const r = await runAgentCommand({ command: 'pending', args: [5] }, h.deps);
    expect(r).toMatchObject({ ok: true, hasField: true });
    const text = JSON.stringify(r);
    expect(text).not.toContain('123456');
    expect(text).not.toContain('zzz');
  });

  it('rate limits after 10 requests and logs each', async () => {
    const h = makeDeps({ entries: [] });
    for (let i = 0; i < 10; i++) await runAgentCommand({ command: 'pending', args: [5] }, h.deps);
    const r = await runAgentCommand({ command: 'pending', args: [5] }, h.deps);
    expect(r).toMatchObject({ ok: false, error: 'rate limit reached' });
    expect(h.log).toHaveLength(11);
    expect((await runAgentCommand({ command: 'status' }, h.deps)).rateLeft).toBe(0);
  });

  it('rejects unknown commands and a missing tab id', async () => {
    const { deps } = makeDeps();
    expect(await runAgentCommand({ command: 'rm' }, deps)).toMatchObject({ ok: false });
    expect(await runAgentCommand({ command: 'pending' }, deps)).toMatchObject({ error: 'tab id required' });
  });
});
