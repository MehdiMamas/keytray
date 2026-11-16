import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_ALLOWLIST,
  LOG_MAX,
  RateLimiter,
  appendLog,
  applyFileConfig,
  isAllowedUrl,
  normalizeAllowlist,
  runAgentCommand,
  senderDomain,
  entrySite,
  siteOf,
  urlSite,
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

describe('all sites', () => {
  it('normalizeAllowlist keeps * exactly once', () => {
    expect(normalizeAllowlist(['*', ' * ', 'github.com'])).toEqual(['*', 'github.com']);
  });
  it('isAllowedUrl with * allows any https host', () => {
    expect(isAllowedUrl('https://example.org', ['*'])).toBe(true);
    expect(isAllowedUrl('https://a.b.example.org', ['*'])).toBe(true);
    expect(isAllowedUrl('http://example.org', ['*'])).toBe(false);
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
    dmarc: 'pass',
    ...over,
  };
}

function makeDeps(opts: {
  enabled?: boolean;
  tabUrl?: string | null;
  entries?: CodeEntry[];
  fillResult?: boolean;
  onPoll?: () => void;
  allowlist?: string[];
} = {}) {
  let t = NOW;
  const calls = { fill: [] as string[], nav: [] as string[], polls: 0, frameChecks: [] as boolean[], probe: [] as boolean[] };
  const used = new Set<string>();
  const log: AgentLogEntry[] = [];
  const entries = opts.entries ?? [entry()];
  const deps: AgentDeps = {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    getConfig: async () => ({ enabled: opts.enabled ?? true, allowlist: opts.allowlist ?? DEFAULT_AGENT_ALLOWLIST }),
    getTabUrl: async () => (opts.tabUrl === undefined ? 'https://github.com/sessions/two-factor' : opts.tabUrl),
    hasCodeField: async () => true,
    getEntries: async () => entries,
    getUsed: async () => used,
    markUsed: async (id) => {
      used.add(id);
    },
    fill: async (_tab, code, allowed) => {
      calls.frameChecks.push(allowed('https://github.com/x'), allowed('https://evil.com/x'));
      calls.probe.push(
        allowed('https://example.org/x'),
        allowed('https://login.example.org'),
        allowed('https://ads.other.net'),
      );
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

  it('with * fills on an unlisted tab only from a sender of the same site', async () => {
    const entries = [
      entry({ id: 'a:2', code: '222222', from: 'X <noreply@other.net>', receivedAt: NOW - 5_000 }),
      entry({ id: 'a:3', code: '333333', from: 'Ex <no-reply@example.org>', receivedAt: NOW - 20_000 }),
    ];
    const h = makeDeps({ tabUrl: 'https://app.example.org/login', allowlist: ['*'], entries });
    expect(await runAgentCommand({ command: 'fill_code', args: [5] }, h.deps)).toMatchObject({ ok: true, filled: true });
    expect(h.calls.fill).toEqual(['333333']);
    expect(h.calls.probe).toEqual([true, true, false]);
  });

  it('with * a phishing tab gets nothing from another site sender', async () => {
    const h = makeDeps({ tabUrl: 'https://github-login.example-phish.com/x', allowlist: ['*'] });
    expect(await runAgentCommand({ command: 'fill_code', args: [5] }, h.deps)).toMatchObject({ ok: false });
    expect(h.calls.fill).toHaveLength(0);
    const p = await runAgentCommand({ command: 'pending', args: [5] }, h.deps);
    expect(p).toMatchObject({ ok: true, codeAvailable: null, linkAvailable: null });
  });

  it('without * an unlisted tab is refused', async () => {
    const h = makeDeps({ tabUrl: 'https://app.example.org/', allowlist: ['github.com'], entries: [entry({ from: 'a@example.org' })] });
    expect(await runAgentCommand({ command: 'fill_code', args: [5] }, h.deps)).toMatchObject({ error: 'site is not allowlisted' });
  });

  it('private suffixes are public suffixes', async () => {
    const e = [entry({ from: 'x@foo.vercel.app' })];
    const other = makeDeps({ tabUrl: 'https://bar.vercel.app/', allowlist: ['*'], entries: e });
    await runAgentCommand({ command: 'fill_code', args: [5] }, other.deps);
    expect(other.calls.fill).toHaveLength(0);
    const same = makeDeps({ tabUrl: 'https://foo.vercel.app/', allowlist: ['*'], entries: e });
    await runAgentCommand({ command: 'fill_code', args: [5] }, same.deps);
    expect(same.calls.fill).toHaveLength(1);
    const bare = makeDeps({ tabUrl: 'https://vercel.app/', allowlist: ['*'], entries: [entry({ from: 'x@vercel.app' })] });
    await runAgentCommand({ command: 'fill_code', args: [5] }, bare.deps);
    expect(bare.calls.fill).toHaveLength(0);
  });

  it('a display name with an address does not fool the match', async () => {
    const h = makeDeps({
      tabUrl: 'https://example.org/',
      allowlist: ['*'],
      entries: [entry({ from: '"noreply@example.org" <a@evil.test>' })],
    });
    await runAgentCommand({ command: 'fill_code', args: [5] }, h.deps);
    expect(h.calls.fill).toHaveLength(0);
  });

  it('dmarc fail is excluded in sender mode but fine for listed sites', async () => {
    const e = [entry({ from: 'a@example.org', dmarc: 'fail' })];
    const s = makeDeps({ tabUrl: 'https://example.org/', allowlist: ['*'], entries: e });
    await runAgentCommand({ command: 'fill_code', args: [5] }, s.deps);
    expect(s.calls.fill).toHaveLength(0);
    const l = makeDeps({ entries: [entry({ dmarc: 'fail' })], allowlist: ['*', 'github.com'] });
    await runAgentCommand({ command: 'fill_code', args: [5] }, l.deps);
    expect(l.calls.fill).toHaveLength(1);
  });

  it('listed tab with * still takes any sender', async () => {
    const h = makeDeps({ allowlist: ['*', 'github.com'], entries: [entry({ from: 'Z <a@other.net>' })] });
    await runAgentCommand({ command: 'fill_code', args: [5] }, h.deps);
    expect(h.calls.fill).toHaveLength(1);
  });

  it('re-reads the tab URL while waiting and does not fill a navigated tab', async () => {
    const h = makeDeps({ tabUrl: 'https://app.example.org/', allowlist: ['*'], entries: [] });
    let reads = 0;
    h.deps.getTabUrl = async () => (reads++ === 0 ? 'https://app.example.org/' : 'https://evil.test/');
    h.deps.getEntries = async () => (h.calls.polls >= 1 ? [entry({ from: 'a@example.org', receivedAt: h.deps.now() })] : []);
    const r = await runAgentCommand({ command: 'fill_code', args: [5, 60] }, h.deps);
    expect(r).toMatchObject({ ok: false });
    expect(h.calls.fill).toHaveLength(0);
  });

  it('a vanished tab while waiting returns tab not found', async () => {
    const h = makeDeps({ tabUrl: 'https://app.example.org/', allowlist: ['*'], entries: [] });
    let reads = 0;
    h.deps.getTabUrl = async () => (reads++ === 0 ? 'https://app.example.org/' : null);
    const r = await runAgentCommand({ command: 'fill_code', args: [5, 60] }, h.deps);
    expect(r).toMatchObject({ ok: false, error: 'tab not found' });
  });

  it('open_link in sender mode needs sender and link on the tab site', async () => {
    const opts = { tabUrl: 'https://example.org/login', allowlist: ['*'] };
    const good = makeDeps({ ...opts, entries: [entry({ kind: 'link', from: 'a@example.org', url: 'https://login.example.org/v?t=s' })] });
    expect(await runAgentCommand({ command: 'open_link', args: [5] }, good.deps)).toMatchObject({ ok: true, opened: true });
    expect(good.calls.nav).toEqual(['https://login.example.org/v?t=s']);
    const offsite = makeDeps({ ...opts, entries: [entry({ kind: 'link', from: 'a@example.org', url: 'https://other.net/v' })] });
    expect(await runAgentCommand({ command: 'open_link', args: [5] }, offsite.deps)).toMatchObject({ ok: false });
    expect(offsite.calls.nav).toHaveLength(0);
    const foreign = makeDeps({ ...opts, entries: [entry({ kind: 'link', from: 'a@other.net', url: 'https://example.org/v' })] });
    expect(await runAgentCommand({ command: 'open_link', args: [5] }, foreign.deps)).toMatchObject({ ok: false });
    expect(foreign.calls.nav).toHaveLength(0);
  });
});

describe('siteOf and senderDomain', () => {
  it('finds the registrable domain, incl. private suffixes', () => {
    expect(siteOf('a.b.example.org')).toBe('example.org');
    expect(siteOf('Example.ORG.')).toBe('example.org');
    expect(siteOf('x.co.jp')).toBe('x.co.jp');
    expect(siteOf('foo.vercel.app')).toBe('foo.vercel.app');
    expect(siteOf('bücher.example')).toBe('xn--bcher-kva.example');
  });
  it('fails closed', () => {
    for (const v of ['', 'vercel.app', 'com', 'a b', '%%%', 'localhost', '127.0.0.1']) expect(siteOf(v)).toBe('');
  });
  it('reads the domain after the last @ inside the last <...>', () => {
    expect(senderDomain('GitHub <noreply@github.com>')).toBe('github.com');
    expect(senderDomain('"noreply@github.com" <x@evil.com>')).toBe('evil.com');
    expect(senderDomain('a@b@Example.org')).toBe('example.org');
    expect(senderDomain('  a@example.org ')).toBe('example.org');
    expect(senderDomain('no address')).toBe('');
    expect(senderDomain('a@')).toBe('');
    // An address inside a comment is not the sender.
    expect(senderDomain('"X" <a@evil.test> (note <b@good.com>)')).toBe('evil.test');
    expect(senderDomain('<a@evil.test> (<b@good.com>)')).toBe('evil.test');
    for (const odd of [
      'A <a@evil.test>, B <b@good.com>',
      'a@evil.test, b@good.com',
      '<a@evil.test> <b@good.com>',
      'X <a@evil.test',
      '"unclosed <a@good.com>',
    ]) {
      expect(senderDomain(odd)).toBe('');
    }
    expect(senderDomain('"GitHub, Inc." <noreply@github.com>')).toBe('github.com');
    expect(senderDomain('GitHub (bot) <noreply@github.com>')).toBe('github.com');
    for (const odd of ['x@good.com/y', 'x@good.com#x', 'x@good.com:80', 'x@good.com?x', 'x@good.com\\y', 'x@go%6fd.com']) {
      expect(senderDomain(odd)).toBe('');
    }
  });
  it('entrySite needs a DMARC pass', () => {
    expect(entrySite(entry({ from: 'a@example.org' }))).toBe('example.org');
    expect(entrySite(entry({ from: 'a@example.org', dmarc: undefined }))).toBe('');
    expect(entrySite(entry({ from: 'a@example.org', dmarc: 'fail' }))).toBe('');
  });
  it('urlSite requires https', () => {
    expect(urlSite('http://example.org')).toBe('');
    expect(urlSite('https://a.example.org/x')).toBe('example.org');
    expect(urlSite('junk')).toBe('');
  });
});

describe('applyFileConfig', () => {
  const base = {
    agentEnabled: false,
    agentAllowlist: ['github.com'],
    agentConfigFromFile: false,
    agentOffByUser: false,
    agentAllowAllFromFile: false,
    agentAllowAllOffByUser: false,
  };
  const ownStar = {
    ...base,
    agentEnabled: true,
    agentConfigFromFile: true,
    agentAllowAllFromFile: true,
    agentAllowlist: ['github.com', '*'],
  };

  it('changes nothing without a file or without agentSignIn', () => {
    expect(applyFileConfig(base, null)).toBeNull();
    expect(applyFileConfig(base, {})).toBeNull();
    expect(applyFileConfig(base, { agentSignIn: false, allowAll: true })).toBeNull();
  });

  it('turns the agent on and marks it as from the file', () => {
    expect(applyFileConfig(base, { agentSignIn: true })).toEqual({ agentEnabled: true, agentConfigFromFile: true });
  });

  it('adds * once when allowAll is true and records that the file added it', () => {
    expect(applyFileConfig(base, { agentSignIn: true, allowAll: true })).toEqual({
      agentEnabled: true,
      agentConfigFromFile: true,
      agentAllowlist: ['github.com', '*'],
      agentAllowAllFromFile: true,
    });
    expect(applyFileConfig(ownStar, { agentSignIn: true, allowAll: true })).toBeNull();
  });

  it('does not claim the from-file flag when the user had turned the agent on', () => {
    const user = { ...base, agentEnabled: true };
    expect(applyFileConfig(user, { agentSignIn: true })).toBeNull();
  });

  it('does not claim a * the user added, and never removes it', () => {
    const user = { ...base, agentEnabled: true, agentConfigFromFile: true, agentAllowlist: ['*'] };
    expect(applyFileConfig(user, { agentSignIn: true, allowAll: true })).toBeNull();
    expect(applyFileConfig(user, { agentSignIn: true, allowAll: false })).toBeNull();
    expect(applyFileConfig(user, null)).toEqual({ agentConfigFromFile: false });
  });

  it('does not re-add * after the user removed it', () => {
    const removed = { ...base, agentEnabled: true, agentConfigFromFile: true, agentAllowAllOffByUser: true };
    expect(applyFileConfig(removed, { agentSignIn: true, allowAll: true })).toBeNull();
  });

  it('does not re-add * when the file flag is set but the user took it out', () => {
    const gone = { ...ownStar, agentAllowlist: ['github.com'] };
    expect(applyFileConfig(gone, { agentSignIn: true, allowAll: true })).toBeNull();
  });

  it('removes only the * the file added when allowAll goes false or the file goes away', () => {
    const patch = { agentAllowAllFromFile: false, agentAllowlist: ['github.com'] };
    expect(applyFileConfig(ownStar, { agentSignIn: true, allowAll: false })).toEqual(patch);
    expect(applyFileConfig(ownStar, { agentSignIn: true })).toEqual(patch);
    expect(applyFileConfig(ownStar, null)).toEqual({ ...patch, agentConfigFromFile: false });
    expect(applyFileConfig(ownStar, { agentSignIn: false, allowAll: true })).toEqual({
      ...patch,
      agentConfigFromFile: false,
    });
  });

  it('lets the Options off switch win over turning on, but still removes the file star', () => {
    expect(applyFileConfig({ ...base, agentOffByUser: true }, { agentSignIn: true, allowAll: true })).toBeNull();
    expect(applyFileConfig({ ...ownStar, agentOffByUser: true }, null)).toEqual({
      agentAllowAllFromFile: false,
      agentAllowlist: ['github.com'],
      agentConfigFromFile: false,
    });
  });

  it('clears the from-file flag when the file goes away, leaving agentEnabled', () => {
    const on = { ...base, agentEnabled: true, agentConfigFromFile: true };
    expect(applyFileConfig(on, null)).toEqual({ agentConfigFromFile: false });
    expect(applyFileConfig(on, { agentSignIn: false })).toEqual({ agentConfigFromFile: false });
  });

  it('returns null when nothing would change', () => {
    const on = { ...base, agentEnabled: true, agentConfigFromFile: true };
    expect(applyFileConfig(on, { agentSignIn: true })).toBeNull();
  });
});
