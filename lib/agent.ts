/**
 * Agent sign-in: pure logic. A local agent asks Keytray to fill the newest code
 * into a tab or open the newest sign-in link in it. The agent never sees the
 * code or the URL. Chrome access is injected through AgentDeps so this file
 * is unit-testable.
 */
import { getDomain } from 'tldts';
import { CODE_MAX_AGE_MS, type CodeEntry } from './types';

export const DEFAULT_AGENT_ALLOWLIST = ['github.com', 'google.com', 'vercel.com', 'apple.com'];
/** Allowlist entry meaning every https site. */
export const ALL_SITES = '*';
export const RATE_LIMIT_MAX = 10;
export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const LOG_MAX = 200;
export const MAX_WAIT_SECONDS = 120;
export const WAIT_POLL_GAP_MS = 5000;

export type AgentCommandName = 'status' | 'pending' | 'fill_code' | 'open_link';
export interface AgentRequest {
  id?: string | number;
  command?: string;
  args?: unknown;
}

export interface AgentLogEntry {
  time: number;
  command: string;
  host: string;
  result: string;
}

export type AgentReply = Record<string, unknown>;

/** Normalise a hostname or URL to a lowercase host. Empty when unparsable. */
export function hostOf(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return '';
  }
}

export function normalizeAllowlist(list: string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    let item = raw.trim().toLowerCase();
    if (!item) continue;
    if (item === ALL_SITES) {
      if (!out.includes(ALL_SITES)) out.push(ALL_SITES);
      continue;
    }
    if (item.includes('://')) item = hostOf(item);
    item = item.replace(/^\*\./, '').replace(/\/.*$/, '').replace(/\.$/, '');
    if (item && !out.includes(item)) out.push(item);
  }
  return out;
}

/**
 * True when the URL is https and its host equals an allowlisted host or is a
 * subdomain of it. A '*' entry allows any https host.
 */
export function isAllowedUrl(url: string, allowlist: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  return normalizeAllowlist(allowlist).some(
    (entry) => entry === ALL_SITES || host === entry || host.endsWith(`.${entry}`),
  );
}

/**
 * Registrable domain (site) of a host, counting private suffixes such as
 * vercel.app or github.io as public. Empty when unparsable or when the host is
 * itself a public suffix. Fails closed.
 */
export function siteOf(host: string): string {
  try {
    const name = new URL('https://' + host.trim()).hostname.toLowerCase().replace(/\.$/, '');
    return getDomain(name, { allowPrivateDomains: true }) ?? '';
  } catch {
    return '';
  }
}

/** Domain of the address in a From header: after the last '@' of the last <...>. */
export function senderDomain(from: string): string {
  const brackets = [...from.matchAll(/<([^<>]*)>/g)];
  const addr = (brackets.length ? brackets[brackets.length - 1][1] : from).trim();
  const at = addr.lastIndexOf('@');
  if (at < 0) return '';
  const domain = addr.slice(at + 1).replace(/[>\s]+$/, '');
  if (!domain) return '';
  try {
    return new URL('https://' + domain).hostname;
  } catch {
    return '';
  }
}

/** Site of the entry's sender; empty when unknown or when the mail failed DMARC. */
export function entrySite(e: CodeEntry): string {
  if (e.dmarc === 'fail') return '';
  return siteOf(senderDomain(e.from));
}

/** Site of an https URL; empty for anything else. */
export function urlSite(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? siteOf(parsed.hostname) : '';
  } catch {
    return '';
  }
}

export class RateLimiter {
  private hits: number[] = [];
  constructor(
    private max = RATE_LIMIT_MAX,
    private windowMs = RATE_LIMIT_WINDOW_MS,
  ) {}
  private prune(now: number): void {
    this.hits = this.hits.filter((t) => now - t < this.windowMs);
  }
  remaining(now: number): number {
    this.prune(now);
    return Math.max(0, this.max - this.hits.length);
  }
  /** Records a hit and returns true, or returns false when the budget is spent. */
  take(now: number): boolean {
    this.prune(now);
    if (this.hits.length >= this.max) return false;
    this.hits.push(now);
    return true;
  }
}

export function appendLog(log: AgentLogEntry[], entry: AgentLogEntry): AgentLogEntry[] {
  return [...log, entry].slice(-LOG_MAX);
}

const SECRET_KEYS = new Set(['code', 'otp', 'link', 'url', 'token', 'secret', 'password']);

/** Recursively drops keys that could carry a secret. */
export function sanitizeReply<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => sanitizeReply(item)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(key.toLowerCase())) continue;
      out[key] = sanitizeReply(item);
    }
    return out as T;
  }
  return value;
}

export function newestUsable(
  entries: CodeEntry[],
  used: ReadonlySet<string>,
  now: number,
  want: 'code' | 'link',
  accept?: (e: CodeEntry) => boolean,
): CodeEntry | undefined {
  return entries
    .filter((e) => {
      if (used.has(e.id)) return false;
      if (now - e.receivedAt > CODE_MAX_AGE_MS) return false;
      if (accept && !accept(e)) return false;
      return want === 'code' ? (e.kind ?? 'code') === 'code' : Boolean(e.url);
    })
    .sort((a, b) => b.receivedAt - a.receivedAt)[0];
}

export interface AgentDeps {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Current settings. */
  getConfig(): Promise<{ enabled: boolean; allowlist: string[] }>;
  getTabUrl(tabId: number): Promise<string | null>;
  hasCodeField(tabId: number): Promise<boolean>;
  getEntries(): Promise<CodeEntry[]>;
  getUsed(): Promise<ReadonlySet<string>>;
  markUsed(id: string): Promise<void>;
  /**
   * Fill the code into the tab. Must only send it to frames whose URL passes
   * isFrameAllowed. Returns true when a field was filled. Never submits.
   */
  fill(tabId: number, code: string, isFrameAllowed: (url: string) => boolean): Promise<boolean>;
  navigate(tabId: number, url: string): Promise<void>;
  /** Poll Gmail once. */
  poll(): Promise<void>;
  limiter: RateLimiter;
  addLog(entry: AgentLogEntry): Promise<void>;
}

function tabIdArg(args: unknown): number | null {
  const list = Array.isArray(args) ? args : [];
  const n = Number(list[0]);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function waitArg(args: unknown): number {
  const list = Array.isArray(args) ? args : [];
  const n = Number(list[1] ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), MAX_WAIT_SECONDS);
}

function age(entry: CodeEntry, now: number): number {
  return Math.max(0, Math.round((now - entry.receivedAt) / 1000));
}

function senderName(from: string): string {
  const match = from.match(/^(.*?)\s*</);
  return (match?.[1] || from).replace(/"/g, '').trim();
}

/** Runs one request: checks, rate limit, handler, log. The reply is already sanitised. */
export async function runAgentCommand(request: AgentRequest, deps: AgentDeps): Promise<AgentReply> {
  const command = String(request.command ?? '');
  let host = '';
  const finish = async (reply: AgentReply): Promise<AgentReply> => {
    const result = reply.ok === true ? 'ok' : String(reply.error ?? 'error');
    await deps.addLog({ time: deps.now(), command, host, result });
    return sanitizeReply(reply);
  };
  const config = await deps.getConfig();

  if (command === 'status') {
    return sanitizeReply({
      ok: true,
      enabled: config.enabled,
      allowlist: normalizeAllowlist(config.allowlist),
      rateLeft: deps.limiter.remaining(deps.now()),
    });
  }
  if (!['pending', 'fill_code', 'open_link'].includes(command)) {
    return finish({ ok: false, error: 'unknown command' });
  }
  if (!config.enabled) return finish({ ok: false, error: 'agent sign-in is off' });
  const tabId = tabIdArg(request.args);
  if (tabId === null) return finish({ ok: false, error: 'tab id required' });
  if (!deps.limiter.take(deps.now())) return finish({ ok: false, error: 'rate limit reached' });

  const normalized = normalizeAllowlist(config.allowlist);
  const hasAll = normalized.includes(ALL_SITES);
  const listedOnly = normalized.filter((e) => e !== ALL_SITES);

  type Ctx =
    | { error: string }
    | {
        accept: (e: CodeEntry) => boolean;
        frameOk: (e: CodeEntry) => (u: string) => boolean;
        linkOk: (e: CodeEntry, u: string) => boolean;
      };
  /**
   * Reads the tab's current URL and decides the mode. Listed sites take any
   * sender. With '*', other https sites only take mail from their own site.
   */
  const context = async (): Promise<Ctx> => {
    const url = await deps.getTabUrl(tabId);
    if (!url) return { error: 'tab not found' };
    host = hostOf(url);
    if (isAllowedUrl(url, listedOnly)) {
      return {
        accept: () => true,
        frameOk: () => (u) => isAllowedUrl(u, listedOnly),
        linkOk: (_e, u) => isAllowedUrl(u, listedOnly),
      };
    }
    const tabSite = hasAll ? urlSite(url) : '';
    if (!tabSite) return { error: 'site is not allowlisted' };
    return {
      accept: (e) => entrySite(e) !== '' && entrySite(e) === tabSite,
      frameOk: (e) => (u) => urlSite(u) === entrySite(e),
      linkOk: (e, u) => urlSite(u) === entrySite(e),
    };
  };

  if (command === 'pending') {
    const ctx = await context();
    if ('error' in ctx) return finish({ ok: false, error: ctx.error });
    const [hasField, entries, used] = await Promise.all([deps.hasCodeField(tabId), deps.getEntries(), deps.getUsed()]);
    const now = deps.now();
    const code = newestUsable(entries, used, now, 'code', ctx.accept);
    const link = newestUsable(entries, used, now, 'link', ctx.accept);
    const pick = (e?: CodeEntry) => (e ? { sender: senderName(e.from), ageSeconds: age(e, now) } : null);
    return finish({ ok: true, hasField, codeAvailable: pick(code), linkAvailable: pick(link) });
  }

  if (command === 'fill_code') {
    const deadline = deps.now() + waitArg(request.args) * 1000;
    for (;;) {
      // Re-read the tab on every pass: it may have navigated while we waited.
      let ctx = await context();
      if ('error' in ctx) return finish({ ok: false, error: ctx.error });
      const entry = newestUsable(await deps.getEntries(), await deps.getUsed(), deps.now(), 'code', ctx.accept);
      if (entry) {
        ctx = await context();
        if ('error' in ctx) return finish({ ok: false, error: ctx.error });
        if (!ctx.accept(entry)) return finish({ ok: false, error: 'site is not allowlisted' });
        const filled = await deps.fill(tabId, entry.code, ctx.frameOk(entry));
        if (!filled) return finish({ ok: false, error: 'no code field filled on this tab' });
        await deps.markUsed(entry.id);
        return finish({ ok: true, filled: true, sender: senderName(entry.from), ageSeconds: age(entry, deps.now()) });
      }
      if (deps.now() >= deadline) {
        return finish({ ok: false, error: waitArg(request.args) > 0 ? 'timed out waiting for a code' : 'no fresh code' });
      }
      try {
        await deps.poll();
      } catch {
        // Keep waiting; the next poll may work.
      }
      if (deps.now() >= deadline) continue;
      await deps.sleep(Math.min(WAIT_POLL_GAP_MS, Math.max(0, deadline - deps.now())));
    }
  }

  // open_link
  let ctx = await context();
  if ('error' in ctx) return finish({ ok: false, error: ctx.error });
  const entry = newestUsable(await deps.getEntries(), await deps.getUsed(), deps.now(), 'link', ctx.accept);
  if (!entry?.url) return finish({ ok: false, error: 'no fresh sign-in link' });
  ctx = await context();
  if ('error' in ctx) return finish({ ok: false, error: ctx.error });
  if (!ctx.accept(entry)) return finish({ ok: false, error: 'site is not allowlisted' });
  if (!ctx.linkOk(entry, entry.url)) return finish({ ok: false, error: 'link site is not allowlisted' });
  await deps.navigate(tabId, entry.url);
  await deps.markUsed(entry.id);
  return finish({ ok: true, opened: true, sender: senderName(entry.from), ageSeconds: age(entry, deps.now()) });
}
