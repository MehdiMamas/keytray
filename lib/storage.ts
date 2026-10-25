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
