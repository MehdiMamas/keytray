import { browser } from 'wxt/browser';
import type { ExtensionRequest, ExtensionResponse, FillResponse } from '~/lib/messages';
import { AuthError, HistoryExpiredError, gmailMessageUrl, pollGmail } from '~/lib/gmail';
import { extractCode } from '~/lib/extract';
import { extractVerificationLink, linkHost } from '~/lib/extract-link';
import { refreshAccessToken } from '~/lib/auth';
import { FREE_ACCOUNT_LIMIT, isNewAccountAllowed, UPGRADE_REQUIRED_ERROR } from '~/lib/account-limit';
import { cachePaid, createExtPay, readPaid, refreshPaid } from '~/lib/billing';
import { loadState, resolveMode, saveState, toPublicState } from '~/lib/storage';
import {
  CODE_MAX_AGE_MS,
  MAX_CODES,
  MAX_PROCESSED_IDS,
  type Account,
  type CodeEntry,
  type PersistedState,
  type PublicState,
} from '~/lib/types';

const TOKEN_SKEW_MS = 5 * 60 * 1000;
let queue: Promise<unknown> = Promise.resolve();

export default defineBackground(() => {
  const extpay = createExtPay();
  extpay.startBackground();
  extpay.onPaid.addListener((user) => {
    void cachePaid(user.paid === true);
  });
  void ensureAlarm();
  browser.runtime.onInstalled.addListener(() => {
    void ensureAlarm();
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'poll') void enqueue(() => pollAccounts());
  });
  browser.notifications.onClicked.addListener((notificationId) => {
    void openNotifiedMessage(notificationId);
  });
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void handleMessage(message as ExtensionRequest)
      .then((response) => sendResponse(response))
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : 'Something went wrong';
        sendResponse({ ok: false, error: text } satisfies ExtensionResponse);
      });
    return true;
  });
});

async function ensureAlarm(): Promise<void> {
  const existing = await browser.alarms.get('poll');
  if (!existing) await browser.alarms.create('poll', { periodInMinutes: 0.5 });
}

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function publish(state: PersistedState): Promise<PublicState> {
  return toPublicState(state, await readPaid());
}

async function handleMessage(message: ExtensionRequest): Promise<ExtensionResponse> {
  switch (message.type) {
    case 'GET_STATE': {
      const state = await loadState();
      return { ok: true, state: await publish(state) };
    }
    case 'REFRESH_BILLING': {
      await refreshPaid();
      const state = await loadState();
      return { ok: true, state: await publish(state) };
    }
    case 'POLL':
    case 'OTP_PAGE_DETECTED': {
      const state = await loadState();
      if (!state.settings.fastPoll) return { ok: true, state: await publish(state) };
      const next = await enqueue(() => pollAccounts());
      return { ok: true, state: await publish(next) };
    }
    case 'SYNC': {
      const next = await enqueue(() => pollAccounts(message.accountEmail));
      return { ok: true, state: await publish(next) };
    }
    case 'SAVE_ACCOUNT': {
      const next = await enqueue(async () => {
        const state = await loadState();
        const existing = state.accounts.find((account) => account.email === message.account.email);
        const paid =
          !existing && state.accounts.length >= FREE_ACCOUNT_LIMIT ? await refreshPaid() : await readPaid();
        if (!isNewAccountAllowed(state.accounts.length, Boolean(existing), paid)) {
          throw new Error(UPGRADE_REQUIRED_ERROR);
        }
        const account: Account = {
          email: message.account.email,
          token: message.account.token,
          expiresAt: message.account.expiresAt,
          historyId: existing?.historyId,
          mode: existing?.mode,
          needsReauth: false,
        };
        state.accounts = [
          account,
          ...state.accounts.filter((item) => item.email !== account.email),
        ];
        await saveState(state);
        return state;
      });
      void enqueue(() => pollAccounts(message.account.email));
      return { ok: true, state: await publish(next) };
    }
    case 'REMOVE_ACCOUNT': {
      const next = await enqueue(async () => {
        const state = await loadState();
        state.accounts = state.accounts.filter((account) => account.email !== message.email);
        state.codes = state.codes.filter((code) => code.account !== message.email);
        state.processedIds = state.processedIds.filter((id) => !id.startsWith(`${message.email}:`));
        await saveState(state);
        await updateBadge(state.unseen);
        return state;
      });
      return { ok: true, state: await publish(next) };
    }
    case 'SET_ACCOUNT_MODE': {
      const next = await enqueue(async () => {
        const state = await loadState();
        const account = state.accounts.find((item) => item.email === message.email);
        if (account) {
          if (message.mode) account.mode = message.mode;
          else delete account.mode;
        }
        await saveState(state);
        return state;
      });
      return { ok: true, state: await publish(next) };
    }
    case 'SET_SETTINGS': {
      const next = await enqueue(async () => {
        const state = await loadState();
        state.settings = { ...state.settings, ...message.settings };
        await saveState(state);
        return state;
      });
      return { ok: true, state: await publish(next) };
    }
    case 'MARK_SEEN': {
      const next = await enqueue(async () => {
        const state = await loadState();
        state.unseen = 0;
        await saveState(state);
        await updateBadge(0);
        return state;
      });
      return { ok: true, state: await publish(next) };
    }
    case 'CLEAR_HISTORY': {
      const next = await enqueue(async () => {
        const state = await loadState();
        state.codes = [];
        state.processedIds = [];
        state.unseen = 0;
        state.lastSyncedAt = null;
        for (const account of state.accounts) delete account.historyId;
        await saveState(state);
        await updateBadge(0);
        return pollAccounts();
      });
      return { ok: true, state: await publish(next) };
    }
    case 'ARCHIVE_HISTORY': {
      const next = await enqueue(async () => {
        const state = await loadState();
        state.codes = [];
        state.unseen = 0;
        await saveState(state);
        await updateBadge(0);
        return state;
      });
      return { ok: true, state: await publish(next) };
    }
    default:
      return { ok: false, error: 'Unknown message' };
  }
}

async function pollAccounts(onlyEmail?: string): Promise<PersistedState> {
  const state = await loadState();
  const targets = onlyEmail ? state.accounts.filter((account) => account.email === onlyEmail) : state.accounts;
  if (targets.length === 0) return state;
  const fresh: CodeEntry[] = [];
  let failures = 0;
  let lastError: unknown;

  for (const account of targets) {
    try {
      const found = await pollOne(state, account);
      fresh.push(...found);
    } catch (error) {
      failures += 1;
      lastError = error;
      account.syncError = error instanceof Error ? error.message : 'Sync failed';
      console.error('[Gmail OTP] poll failed', account.email, error);
    }
  }

  if (targets.length > 0 && failures === targets.length) {
    await saveState(state);
    throw lastError instanceof Error ? lastError : new Error('Sync failed');
  }

  state.codes = [...fresh, ...state.codes].slice(0, MAX_CODES);
  state.processedIds = state.processedIds.slice(-MAX_PROCESSED_IDS);
  state.lastSyncedAt = Date.now();
  if (fresh.length) state.unseen += fresh.length;
  await saveState(state);
  await updateBadge(state.unseen);
  if (fresh.length) await actOnNewest(state, fresh);
  return state;
}

async function pollOne(state: PersistedState, account: Account): Promise<CodeEntry[]> {
  const token = await ensureToken(state, account);
  if (!token) return [];

  let result;
  try {
    result = await pollGmail(token, account.historyId);
  } catch (error) {
    if (error instanceof AuthError) {
      const refreshed = await refreshAccessToken(account.email);
      if (!refreshed) {
        account.needsReauth = true;
        account.token = undefined;
        return [];
      }
      account.token = refreshed.token;
      account.expiresAt = refreshed.expiresAt;
      account.needsReauth = false;
      result = await pollGmail(refreshed.token, account.historyId);
    } else if (error instanceof HistoryExpiredError) {
      account.historyId = undefined;
      result = await pollGmail(token, undefined);
    } else {
      throw error;
    }
  }

  account.historyId = result.historyId;
  account.needsReauth = false;
  delete account.syncError;
  const found: CodeEntry[] = [];
  for (const message of result.messages) {
    const key = `${account.email}:${message.id}`;
    if (state.processedIds.includes(key)) continue;
    state.processedIds.push(key);
    const code = extractCode(message.subject, message.body);
    const link = extractVerificationLink(message.subject, message.body, message.html);
    if (!code && !link) continue;
    found.push({
      id: key,
      messageId: message.id,
      account: account.email,
      code: code ?? linkHost(link?.url ?? ''),
      from: message.from,
      subject: message.subject,
      receivedAt: message.receivedAt,
      kind: code ? 'code' : 'link',
      ...(link ? { url: link.url } : {}),
    });
  }
  return found;
}

async function ensureToken(state: PersistedState, account: Account): Promise<string | null> {
  if (account.token && account.expiresAt && account.expiresAt - Date.now() > TOKEN_SKEW_MS) return account.token;
  const refreshed = await refreshAccessToken(account.email);
  if (!refreshed) {
    account.needsReauth = true;
    account.token = undefined;
    await saveState(state);
    return null;
  }
  account.token = refreshed.token;
  account.expiresAt = refreshed.expiresAt;
  account.needsReauth = false;
  return refreshed.token;
}

async function actOnNewest(state: PersistedState, fresh: CodeEntry[]): Promise<void> {
  const actionable = fresh
    .filter((entry) => Date.now() - entry.receivedAt < CODE_MAX_AGE_MS)
    .sort((a, b) => b.receivedAt - a.receivedAt);
  const newest = actionable[0];
  if (!newest) return;
  const account = state.accounts.find((item) => item.email === newest.account);
  if (!account) return;
  if (newest.kind === 'link') {
    await notifyLink(state, newest);
    return;
  }
  const mode = resolveMode(account, state.settings);

  if (mode === 'autofill') {
    const filled = await fillActiveTab(newest.code, state.settings.autoSubmit);
    if (!filled) {
      await copyText(newest.code);
      await notify(state, newest, 'No code field on this tab. Copied instead.');
    } else if (state.settings.notifications) {
      await notify(state, newest, 'Filled into the page.');
    }
    return;
  }
  if (mode === 'autocopy') {
    await copyText(newest.code);
    await notify(state, newest, 'Copied to the clipboard.');
  } else if (state.settings.notifications) {
    await notify(state, newest, 'Saved. Nothing was filled or copied.');
  }
}

async function fillActiveTab(code: string, autoSubmit: boolean): Promise<boolean> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) return false;
  let frames: { frameId: number }[] = [];
  try {
    frames = await browser.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => true,
    });
  } catch {
    return false;
  }
  for (const frame of frames) {
    try {
      const response = (await browser.tabs.sendMessage(
        tab.id,
        { type: 'FILL_OTP', code, autoSubmit },
        { frameId: frame.frameId },
      )) as FillResponse | undefined;
      if (response?.filled) return true;
    } catch {
      // Frame has no content script.
    }
  }
  return false;
}

async function copyText(text: string): Promise<void> {
  if (!(await browser.offscreen.hasDocument())) {
    await browser.offscreen.createDocument({
      url: browser.runtime.getURL('/offscreen.html'),
      reasons: ['CLIPBOARD'],
      justification: 'Copy a verification code to the clipboard',
    });
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await browser.runtime.sendMessage({ type: 'OFFSCREEN_COPY', text });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function openNotifiedMessage(notificationId: string): Promise<void> {
  const link = notificationId.startsWith('link-');
  const code = notificationId.startsWith('code-');
  if (!link && !code) return;
  const entryId = notificationId.slice(link ? 'link-'.length : 'code-'.length);
  const state = await loadState();
  const entry = state.codes.find((item) => item.id === entryId);
  if (!entry) return;
  if (link && entry.url?.startsWith('https://')) {
    await browser.tabs.create({ url: entry.url });
    return;
  }
  await browser.tabs.create({ url: gmailMessageUrl(entry.account, entry.messageId) });
}

async function notifyLink(state: PersistedState, entry: CodeEntry): Promise<void> {
  if (!state.settings.notifications || !entry.url) return;
  const host = linkHost(entry.url);
  await browser.notifications.create(`link-${entry.id}`, {
    type: 'basic',
    iconUrl: browser.runtime.getURL('/icons/icon128.png'),
    title: host || 'Verification link',
    message: `${senderName(entry.from)}. Open the verification link.`,
  });
}

async function notify(state: PersistedState, entry: CodeEntry, detail: string): Promise<void> {
  if (!state.settings.notifications) return;
  await browser.notifications.create(`code-${entry.id}`, {
    type: 'basic',
    iconUrl: browser.runtime.getURL('/icons/icon128.png'),
    title: entry.code,
    message: `${detail} ${senderName(entry.from)}`,
  });
}

async function updateBadge(unseen: number): Promise<void> {
  await browser.action.setBadgeBackgroundColor({ color: '#0f6e56' });
  await browser.action.setBadgeText({ text: unseen > 0 ? String(Math.min(unseen, 99)) : '' });
}

function senderName(from: string): string {
  const match = from.match(/^(.*?)\s*</);
  return (match?.[1] || from).replace(/"/g, '').trim();
}
