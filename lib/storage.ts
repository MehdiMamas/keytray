import { browser } from 'wxt/browser';
import { appendLog, type AgentLogEntry } from './agent';
import { EMPTY_STATE, type Account, type PersistedState, type PublicState, type Settings } from './types';

const KEY = 'otpState';

export async function loadState(): Promise<PersistedState> {
  const stored = await browser.storage.local.get(KEY);
  const raw = stored[KEY] as (Partial<PersistedState> & { multiUnlocked?: boolean }) | undefined;
  if (!raw) return structuredClone(EMPTY_STATE);
  const rest = { ...raw };
  delete rest.multiUnlocked;
  return {
    ...structuredClone(EMPTY_STATE),
    ...rest,
    settings: { ...EMPTY_STATE.settings, ...raw.settings },
    accounts: raw.accounts ?? [],
    codes: raw.codes ?? [],
    processedIds: raw.processedIds ?? [],
  };
}

export async function saveState(state: PersistedState): Promise<void> {
  await browser.storage.local.set({ [KEY]: state });
}

export function toPublicState(state: PersistedState, paid: boolean): PublicState {
  return {
    accounts: state.accounts.map(toPublicAccount),
    codes: state.codes,
    settings: state.settings,
    unseen: state.unseen,
    lastSyncedAt: state.lastSyncedAt,
    paid,
  };
}

export function toPublicAccount(account: Account) {
  return {
    email: account.email,
    mode: account.mode,
    needsReauth: account.needsReauth,
    syncError: account.syncError,
    staysSignedIn: Boolean(account.refreshToken),
  };
}

export function resolveMode(account: Account, settings: Settings) {
  return account.mode ?? settings.defaultMode;
}

const AGENT_LOG_KEY = 'agentLog';
const AGENT_USED_KEY = 'agentUsed';
const AGENT_USED_MAX = 100;

export async function loadAgentLog(): Promise<AgentLogEntry[]> {
  const stored = await browser.storage.local.get(AGENT_LOG_KEY);
  const raw = stored[AGENT_LOG_KEY];
  return Array.isArray(raw) ? (raw as AgentLogEntry[]) : [];
}

export async function addAgentLog(entry: AgentLogEntry): Promise<void> {
  await browser.storage.local.set({ [AGENT_LOG_KEY]: appendLog(await loadAgentLog(), entry) });
}

export async function loadAgentUsed(): Promise<Set<string>> {
  const stored = await browser.storage.local.get(AGENT_USED_KEY);
  const raw = stored[AGENT_USED_KEY];
  return new Set(Array.isArray(raw) ? (raw as string[]) : []);
}

export async function markAgentUsed(id: string): Promise<void> {
  const used = [...(await loadAgentUsed()), id].slice(-AGENT_USED_MAX);
  await browser.storage.local.set({ [AGENT_USED_KEY]: used });
}

export async function removeAgentUsed(ids: readonly string[]): Promise<void> {
  const drop = new Set(ids);
  const kept = [...(await loadAgentUsed())].filter((id) => !drop.has(id));
  await browser.storage.local.set({ [AGENT_USED_KEY]: kept });
}

const CUSTOM_OAUTH_KEY = 'customOAuth';
export const GOOGLE_CLIENT_ID_SUFFIX = '.apps.googleusercontent.com';

export interface CustomOAuth {
  clientId: string;
  clientSecret: string;
}

/** Trims both fields. Returns an error text, or the clean pair. */
export function validateCustomOAuth(input: {
  clientId?: string;
  clientSecret?: string;
}): { ok: true; value: CustomOAuth } | { ok: false; error: string } {
  const clientId = (input.clientId ?? '').trim();
  const clientSecret = (input.clientSecret ?? '').trim();
  if (!clientId || !clientSecret) return { ok: false, error: 'Enter both the Client ID and the Client secret.' };
  if (!clientId.endsWith(GOOGLE_CLIENT_ID_SUFFIX)) {
    return { ok: false, error: `The Client ID must end in ${GOOGLE_CLIENT_ID_SUFFIX}` };
  }
  return { ok: true, value: { clientId, clientSecret } };
}

/** Kept apart from PersistedState so the secret is never copied to popup or options state. */
export async function loadCustomOAuth(): Promise<CustomOAuth | undefined> {
  const stored = await browser.storage.local.get(CUSTOM_OAUTH_KEY);
  const raw = stored[CUSTOM_OAUTH_KEY] as Partial<CustomOAuth> | undefined;
  return raw?.clientId && raw.clientSecret ? { clientId: raw.clientId, clientSecret: raw.clientSecret } : undefined;
}

export async function saveCustomOAuth(value: CustomOAuth): Promise<void> {
  await browser.storage.local.set({ [CUSTOM_OAUTH_KEY]: value });
}

export async function clearCustomOAuth(): Promise<void> {
  await browser.storage.local.remove(CUSTOM_OAUTH_KEY);
}
