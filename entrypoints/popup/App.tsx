import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import { linkHost } from '~/lib/extract-link';
import { gmailMessageUrl } from '~/lib/gmail';
import type { ExtensionResponse } from '~/lib/messages';
import type { CodeEntry, PublicState } from '~/lib/types';

type Filter = 'all' | string;

export function App() {
  const [state, setState] = useState<PublicState | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState('');

  const refresh = async () => {
    const response = (await browser.runtime.sendMessage({ type: 'GET_STATE' })) as ExtensionResponse;
    if (response?.ok && response.state) setState(response.state);
  };

  useEffect(() => {
    void browser.runtime.sendMessage({ type: 'MARK_SEEN' });
    void refresh();
    const onChange = () => {
      void refresh();
    };
    browser.storage.onChanged.addListener(onChange);
    const timer = setInterval(() => {
      void browser.runtime.sendMessage({ type: 'POLL' });
    }, 3000);
    return () => {
      browser.storage.onChanged.removeListener(onChange);
      clearInterval(timer);
    };
  }, []);

  const codes = useMemo(() => {
    const list = state?.codes ?? [];
    const filtered = filter === 'all' ? list : list.filter((entry) => entry.account === filter);
    return filtered.slice(0, 5);
  }, [state, filter]);

  const sync = async () => {
    setSyncing(true);
    setError('');
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'SYNC',
        accountEmail: filter === 'all' ? undefined : filter,
      })) as ExtensionResponse;
      if (!response?.ok) setError(response?.error || 'Sync failed');
      else if (response.state) setState(response.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const copy = async (entry: CodeEntry) => {
    await navigator.clipboard.writeText(entry.code);
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId((current) => (current === entry.id ? '' : current)), 1200);
  };

  const openLink = (entry: CodeEntry) => {
    if (!entry.url?.startsWith('https://')) return;
    void browser.tabs.create({ url: entry.url });
  };

  if (!state) {
    return <Shell><p className="px-4 py-8 text-sm text-ink/70">Loading…</p></Shell>;
  }

  if (state.accounts.length === 0) {
    return (
      <Shell>
        <p className="px-4 py-6 text-sm leading-relaxed text-ink/80">
          Connect a Gmail account to start collecting verification codes and sign-in links.
        </p>
        <div className="px-4 pb-4">
          <button className="w-full rounded-lg bg-moss px-3 py-2 text-sm font-semibold text-paper" onClick={() => void browser.runtime.openOptionsPage()}>
            Add an account
          </button>
        </div>
      </Shell>
    );
  }

  const needsReauth = state.accounts.filter((account) => account.needsReauth);
  const syncErrors = state.accounts.filter((account) => account.syncError);

  return (
    <Shell>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <select
          aria-label="Account"
          className="min-w-0 flex-1 rounded-md border border-line bg-white px-2 py-1.5 text-sm"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">All accounts</option>
          {state.accounts.map((account) => (
            <option key={account.email} value={account.email}>
              {account.email}
            </option>
          ))}
        </select>
        <button
          className="rounded-md bg-moss px-3 py-1.5 text-sm font-semibold text-paper disabled:opacity-60"
          onClick={() => void sync()}
          disabled={syncing}
        >
          {syncing ? 'Syncing' : 'Sync'}
        </button>
        <button
          aria-label="Settings"
          className="rounded-md border border-line px-2 py-1.5 text-sm"
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          Settings
        </button>
      </div>

      {needsReauth.length > 0 && (
        <button
          className="block w-full bg-clay/10 px-3 py-2 text-left text-xs text-clay"
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          Reconnect {needsReauth.map((account) => account.email).join(', ')}
        </button>
      )}
      {syncErrors.map((account) => (
        <button
          key={account.email}
          className="block w-full bg-clay/10 px-3 py-2 text-left text-xs text-clay"
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          Sync failed for {account.email}: {account.syncError}
        </button>
      ))}
      {error && <p className="px-3 py-2 text-xs text-clay">{error}</p>}

      {codes.length === 0 ? (
        <p className="px-4 py-8 text-sm text-ink/70">No codes or links yet. Request one, then hit Sync.</p>
      ) : (
        <ul>
          {codes.map((entry) => (
            <li key={entry.id} className="flex items-start gap-2 border-b border-line px-3 py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-lg tracking-wider text-ink" title={displayValue(entry)}>
                  {displayValue(entry)}
                </div>
                <div className="truncate text-xs text-ink/70">{senderName(entry.from)} · {entry.subject || 'No subject'}</div>
                <div className="mt-0.5 text-[11px] text-ink/50">
                  {filter === 'all' ? `${entry.account} · ` : ''}
                  {relativeTime(entry.receivedAt)}
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                {entry.kind === 'link' ? (
                  <button
                    className="rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold"
                    onClick={() => openLink(entry)}
                  >
                    Open link
                  </button>
                ) : (
                  <button
                    className="rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold"
                    onClick={() => void copy(entry)}
                  >
                    {copiedId === entry.id ? 'Copied' : 'Copy'}
                  </button>
                )}
                {entry.kind !== 'link' && entry.url && (
                  <button
                    className="rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold"
                    onClick={() => openLink(entry)}
                  >
                    Open link
                  </button>
                )}
                <button
                  className="rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold"
                  onClick={() => void browser.tabs.create({ url: gmailMessageUrl(entry.account, entry.messageId) })}
                >
                  Open email
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <p className="text-[11px] text-ink/45">
          {state.lastSyncedAt ? `Last synced ${relativeTime(state.lastSyncedAt)}` : 'Not synced yet'}
        </p>
        <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink/70">
          Notify
          <input
            type="checkbox"
            checked={state.settings.notifications}
            onChange={(event) => {
              const notifications = event.target.checked;
              void browser.runtime
                .sendMessage({ type: 'SET_SETTINGS', settings: { notifications } })
                .then((response) => {
                  const result = response as ExtensionResponse;
                  if (result?.ok && result.state) setState(result.state);
                });
            }}
          />
        </label>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="w-[360px] bg-paper font-sans text-ink">{children}</div>;
}

function displayValue(entry: CodeEntry): string {
  return entry.kind === 'link' ? linkHost(entry.url ?? '') || entry.code : entry.code;
}

function senderName(from: string): string {
  const match = from.match(/^(.*?)\s*</);
  return (match?.[1] || from).replace(/"/g, '').trim() || from;
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
