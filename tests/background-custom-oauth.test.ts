import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, unknown> = {};
let listener: (message: unknown, sender: unknown, send: (response: unknown) => void) => boolean;

vi.stubGlobal('defineBackground', (main: () => void) => main);
vi.mock('extpay', () => ({
  default: () => ({ startBackground: () => {}, onPaid: { addListener: () => {} } }),
}));
vi.mock('wxt/browser', () => {
  const event = { addListener: () => {} };
  return {
    browser: {
      alarms: { get: async () => ({ periodInMinutes: 1 }), create: async () => {}, onAlarm: event },
      runtime: {
        onInstalled: event,
        onMessage: {
          addListener: (fn: typeof listener) => {
            listener = fn;
          },
        },
        connectNative: () => ({ onDisconnect: event, onMessage: event, disconnect: () => {} }),
        id: 'ext',
        getURL: (path: string) => `chrome-extension://ext${path}`,
      },
      notifications: { onClicked: event },
      storage: {
        onChanged: event,
        local: {
          get: async (key: string) => ({ [key]: store[key] }),
          set: async (values: Record<string, unknown>) => {
            Object.assign(store, values);
          },
          remove: async (key: string) => {
            delete store[key];
          },
        },
      },
    },
  };
});

const background = (await import('~/entrypoints/background')).default as unknown as () => void;
background();

const optionsPage = { id: 'ext', tab: { id: 2 }, url: 'chrome-extension://ext/options.html' };

function send(
  message: unknown,
  sender: unknown = optionsPage,
): Promise<{ ok: boolean; error?: string; state?: Record<string, unknown> }> {
  return new Promise((resolve) => {
    listener(message, sender, resolve as (response: unknown) => void);
  });
}

const id = 'mine.apps.googleusercontent.com';

describe('SET_CUSTOM_OAUTH', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    store.otpState = {
      accounts: [{ email: 'a@gmail.com', token: 't', expiresAt: 1, refreshToken: 'rt' }],
      codes: [{ id: 'a@gmail.com:1', account: 'a@gmail.com', code: '123456' }],
    };
  });

  it('rejects an invalid Client ID and saves nothing', async () => {
    const response = await send({ type: 'SET_CUSTOM_OAUTH', clientId: 'nope', clientSecret: 's' });
    expect(response.ok).toBe(false);
    expect(store.customOAuth).toBeUndefined();
  });

  it('trims, saves, marks accounts for reconnect and keeps their codes', async () => {
    const response = await send({ type: 'SET_CUSTOM_OAUTH', clientId: ` ${id} `, clientSecret: ' sec ' });
    expect(response.ok).toBe(true);
    expect(store.customOAuth).toEqual({ clientId: id, clientSecret: 'sec' });
    const saved = store.otpState as { accounts: { needsReauth?: boolean; refreshToken?: string }[]; codes: unknown[] };
    expect(saved.accounts[0].needsReauth).toBe(true);
    expect(saved.accounts[0].refreshToken).toBeUndefined();
    expect(saved.codes).toHaveLength(1);
  });

  it('never puts the secret into the saved state or the UI state', async () => {
    const response = await send({ type: 'SET_CUSTOM_OAUTH', clientId: id, clientSecret: 'sec' });
    expect(JSON.stringify(store.otpState)).not.toContain('sec');
    expect(JSON.stringify(response.state)).not.toContain('sec');
    expect(response.state?.customOAuth).toEqual({ clientId: id, hasSecret: true });
  });

  it('saving the same pair again keeps accounts connected', async () => {
    await send({ type: 'SET_CUSTOM_OAUTH', clientId: id, clientSecret: 'sec' });
    const saved = store.otpState as { accounts: { needsReauth?: boolean; refreshToken?: string }[] };
    saved.accounts[0] = { ...saved.accounts[0], needsReauth: false, refreshToken: 'rt2' };
    const response = await send({ type: 'SET_CUSTOM_OAUTH', clientId: id, clientSecret: 'sec' });
    expect(response.ok).toBe(true);
    expect((store.otpState as typeof saved).accounts[0].refreshToken).toBe('rt2');
  });

  it('CLEAR_CUSTOM_OAUTH with nothing saved keeps accounts connected', async () => {
    const response = await send({ type: 'CLEAR_CUSTOM_OAUTH' });
    expect(response.ok).toBe(true);
    expect((store.otpState as { accounts: { needsReauth?: boolean }[] }).accounts[0].needsReauth).toBeUndefined();
  });

  it('CLEAR_CUSTOM_OAUTH removes it and marks accounts for reconnect', async () => {
    await send({ type: 'SET_CUSTOM_OAUTH', clientId: id, clientSecret: 'sec' });
    const response = await send({ type: 'CLEAR_CUSTOM_OAUTH' });
    expect(response.ok).toBe(true);
    expect(store.customOAuth).toBeUndefined();
    expect((store.otpState as { accounts: { needsReauth?: boolean }[] }).accounts[0].needsReauth).toBe(true);
  });
});

describe('custom client messages from a content script', () => {
  it('are allowed from the options page open in a tab, refused elsewhere', async () => {
    const message = { type: 'SET_CUSTOM_OAUTH', clientId: id, clientSecret: 's' };
    const fromTab = await send(message, { id: 'ext', tab: { id: 1 }, url: 'https://example.com/' });
    expect(fromTab.ok).toBe(false);
    const fromOther = await send(message, { id: 'other', url: 'chrome-extension://other/x.html' });
    expect(fromOther.ok).toBe(false);
  });
});
