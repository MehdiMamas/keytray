import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { signInInteractive } from '~/lib/auth';
import { FREE_ACCOUNT_LIMIT } from '~/lib/account-limit';
import { openPaymentPage } from '~/lib/billing';
import { DEFAULT_AGENT_ALLOWLIST, normalizeAllowlist, type AgentLogEntry } from '~/lib/agent';
import { loadAgentLog } from '~/lib/storage';
import type { ExtensionResponse } from '~/lib/messages';
import type { CodeClickAction, Mode, PopupShows, PublicState, Settings } from '~/lib/types';

const MODES: { value: Mode | ''; label: string }[] = [
  { value: '', label: 'Use default' },
  { value: 'autofill', label: 'Auto-fill' },
  { value: 'autocopy', label: 'Auto-copy' },
  { value: 'nothing', label: 'Do nothing' },
];

export function App() {
  const [state, setState] = useState<PublicState | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [agentLog, setAgentLog] = useState<AgentLogEntry[]>([]);
  const [allowlistText, setAllowlistText] = useState('');
  const [allowlistDirty, setAllowlistDirty] = useState(false);
  const refresh = async () => {
    void loadAgentLog().then(setAgentLog);
    const response = (await browser.runtime.sendMessage({ type: 'GET_STATE' })) as ExtensionResponse;
    if (response?.ok && response.state) setState(response.state);
  };

  useEffect(() => {
    void (async () => {
      try {
        const response = (await browser.runtime.sendMessage({ type: 'REFRESH_BILLING' })) as ExtensionResponse;
        if (response?.ok && response.state) {
          setState(response.state);
          return;
        }
      } catch {
        // Fall back to the cached state below.
      }
      await refresh();
    })();
    const onChange = () => {
      void refresh();
    };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, []);

  const addAccount = async (email?: string) => {
    setError('');
    setBusy(email ?? 'add');
    try {
      const account = await signInInteractive(email);
      const response = (await browser.runtime.sendMessage({
        type: 'SAVE_ACCOUNT',
        account,
      })) as ExtensionResponse;
      if (!response?.ok) throw new Error(response?.error || 'Could not save the account');
      if (response.state) setState(response.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy('');
    }
  };

  const updateSettings = async (patch: Partial<Settings>) => {
    const response = (await browser.runtime.sendMessage({ type: 'SET_SETTINGS', settings: patch })) as ExtensionResponse;
    if (response?.ok && response.state) setState(response.state);
  };

  const toggleAgent = async (on: boolean) => {
    setError('');
    await updateSettings({ agentEnabled: on });
  };

  const saveAllowlist = async (text: string) => {
    const list = normalizeAllowlist(text.split(/[\s,]+/));
    await updateSettings({ agentAllowlist: list });
    setAllowlistDirty(false);
    setAllowlistText(list.join('\n'));
  };

  const forgetHistory = async (type: 'CLEAR_HISTORY' | 'ARCHIVE_HISTORY') => {
    setError('');
    setBusy(type);
    try {
      const response = (await browser.runtime.sendMessage({ type })) as ExtensionResponse;
      if (!response?.ok) throw new Error(response?.error || 'Could not update history');
      if (response.state) setState(response.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update history');
    } finally {
      setBusy('');
    }
  };

  const upgrade = async () => {
    setError('');
    setBusy('upgrade');
    try {
      await openPaymentPage();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open checkout');
    } finally {
      setBusy('');
    }
  };

  if (!state) return <main className="mx-auto max-w-xl p-8 font-sans">Loading…</main>;

  const needsUpgrade = state.accounts.length >= FREE_ACCOUNT_LIMIT && !state.paid;

  return (
    <main className="mx-auto max-w-xl px-6 py-8 font-sans text-ink">
      <h1 className="text-2xl font-semibold">Keytray</h1>
      <p className="mt-1 text-sm text-ink/70">Codes stay in this browser. Gmail is read with the readonly scope only.</p>
      {error && <p className="mt-4 rounded-md bg-clay/10 px-3 py-2 text-sm text-clay">{error}</p>}

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Accounts</h2>
          <button
            className="rounded-md bg-moss px-3 py-1.5 text-sm font-semibold text-paper disabled:opacity-60"
            disabled={busy !== ''}
            onClick={() => void (needsUpgrade ? upgrade() : addAccount())}
          >
            {busy === 'add' ? 'Waiting for Google…' : busy === 'upgrade' ? 'Opening checkout…' : needsUpgrade ? 'Upgrade' : 'Add account'}
          </button>
        </div>
        {needsUpgrade && (
          <p className="mt-3 text-sm text-ink/70">One Gmail account is free. Upgrade once to add more.</p>
        )}
        {state.accounts.length === 0 ? (
          <p className="mt-3 text-sm text-ink/70">No accounts connected.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-white">
            {state.accounts.map((account) => (
              <li key={account.email} className="flex flex-wrap items-center gap-2 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{account.email}</div>
                  {account.needsReauth && <div className="text-xs text-clay">Sign-in expired</div>}
                  {account.syncError && <div className="text-xs text-clay">{account.syncError}</div>}
                  {!account.needsReauth && !account.staysSignedIn && (
                    <div className="text-xs text-ink/60">Reconnect once so this account stays signed in.</div>
                  )}
                </div>
                <select
                  aria-label={`Mode for ${account.email}`}
                  className="rounded-md border border-line bg-paper px-2 py-1 text-sm"
                  value={account.mode ?? ''}
                  onChange={(event) => {
                    const mode = event.target.value;
                    void browser.runtime
                      .sendMessage({
                        type: 'SET_ACCOUNT_MODE',
                        email: account.email,
                        mode: mode ? (mode as Mode) : null,
                      })
                      .then(refresh);
                  }}
                >
                  {MODES.map((mode) => (
                    <option key={mode.label} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
                <button className="text-sm text-moss" onClick={() => void addAccount(account.email)} disabled={busy !== ''}>
                  {busy === account.email ? 'Waiting…' : 'Reconnect'}
                </button>
                <button
                  className="text-sm text-clay"
                  onClick={() => {
                    void browser.runtime.sendMessage({ type: 'REMOVE_ACCOUNT', email: account.email }).then(refresh);
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-semibold">When a new code arrives</h2>
        <label className="block text-sm">
          Default action
          <select
            className="mt-1 block w-full rounded-md border border-line bg-white px-2 py-2"
            value={state.settings.defaultMode}
            onChange={(event) => void updateSettings({ defaultMode: event.target.value as Mode })}
          >
            <option value="autofill">Auto-fill the page</option>
            <option value="autocopy">Auto-copy</option>
            <option value="nothing">Do nothing</option>
          </select>
        </label>
        <label className="block text-sm">
          Popup shows
          <select
            className="mt-1 block w-full rounded-md border border-line bg-white px-2 py-2"
            value={state.settings.popupShows}
            onChange={(event) => void updateSettings({ popupShows: event.target.value as PopupShows })}
          >
            <option value="all">Codes and links</option>
            <option value="codes">Codes only</option>
            <option value="links">Links only</option>
          </select>
        </label>
        <label className="block text-sm">
          Clicking a code notification
          <select
            className="mt-1 block w-full rounded-md border border-line bg-white px-2 py-2"
            value={state.settings.codeClickAction}
            onChange={(event) => void updateSettings({ codeClickAction: event.target.value as CodeClickAction })}
          >
            <option value="open">Open the email</option>
            <option value="copy">Copy the code</option>
          </select>
        </label>
        <Toggle
          label="Desktop notification when a code or link arrives"
          checked={state.settings.notifications}
          onChange={(notifications) => void updateSettings({ notifications })}
        />
        <Toggle
          label="Check every few seconds while a code page or this popup is open"
          checked={state.settings.fastPoll}
          onChange={(fastPoll) => void updateSettings({ fastPoll })}
        />
        <Toggle
          label="Submit the form after auto-fill"
          checked={state.settings.autoSubmit}
          onChange={(autoSubmit) => void updateSettings({ autoSubmit })}
        />
        <Toggle
          label="Show the Fill button on code fields"
          checked={state.settings.showFillChip}
          onChange={(showFillChip) => void updateSettings({ showFillChip })}
        />
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            className="rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-60"
            disabled={busy !== ''}
            onClick={() => void forgetHistory('CLEAR_HISTORY')}
          >
            {busy === 'CLEAR_HISTORY' ? 'Reading today\'s mail…' : 'Clear history'}
          </button>
          <button
            className="rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-60"
            disabled={busy !== ''}
            onClick={() => void forgetHistory('ARCHIVE_HISTORY')}
          >
            Archive history
          </button>
        </div>
        <p className="text-xs text-ink/60">
          Clear history forgets what was already read and syncs today’s mail again. Archive history only hides the list.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-semibold">Agent sign-in</h2>
        <p className="text-xs text-ink/60">
          Lets a local program on this computer ask Keytray to fill the newest code, or open the newest sign-in link, in
          a tab. The program never sees the code or the link. It needs the helper from native/install.sh.
        </p>
        <Toggle
          label="Allow agent sign-in"
          checked={state.settings.agentEnabled}
          onChange={(on) => void toggleAgent(on)}
        />
        <label className="block text-sm">
          Allowed sites (one per line, subdomains included)
          <textarea
            className="mt-1 block h-24 w-full rounded-md border border-line bg-white px-2 py-2 font-mono text-xs"
            value={allowlistDirty ? allowlistText : state.settings.agentAllowlist.join('\n')}
            onChange={(event) => {
              setAllowlistText(event.target.value);
              setAllowlistDirty(true);
            }}
          />
        </label>
        <div className="flex gap-2">
          <button
            className="rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-60"
            disabled={!allowlistDirty}
            onClick={() => void saveAllowlist(allowlistText)}
          >
            Save sites
          </button>
          <button
            className="rounded-md border border-line px-3 py-1.5 text-sm"
            onClick={() => void saveAllowlist(DEFAULT_AGENT_ALLOWLIST.join('\n'))}
          >
            Reset to defaults
          </button>
        </div>
        <h3 className="text-sm font-semibold">Recent requests</h3>
        {agentLog.length === 0 ? (
          <p className="text-sm text-ink/70">No requests yet.</p>
        ) : (
          <ul className="max-h-64 divide-y divide-line overflow-auto rounded-lg border border-line bg-white text-xs">
            {[...agentLog].reverse().map((entry, index) => (
              <li key={`${entry.time}-${index}`} className="flex flex-wrap gap-x-3 px-3 py-2">
                <span className="text-ink/60">{new Date(entry.time).toLocaleString()}</span>
                <span className="font-medium">{entry.command}</span>
                <span>{entry.host || '-'}</span>
                <span className={entry.result === 'ok' ? 'text-moss' : 'text-clay'}>{entry.result}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-4 text-sm">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}
