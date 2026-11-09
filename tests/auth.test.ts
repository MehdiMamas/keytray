import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, unknown> = {};
vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (values: Record<string, unknown>) => {
          Object.assign(store, values);
        },
      },
    },
    identity: {
      getRedirectURL: () => 'https://example.chromiumapp.org/',
      launchWebAuthFlow: vi.fn(async () => {
        throw new Error('interaction_required');
      }),
    },
  },
}));

const { refreshAccessToken, resolveClient, TokenRefreshError } = await import('~/lib/auth');

describe('refreshAccessToken', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    vi.stubEnv('WXT_GOOGLE_CLIENT_ID', 'client');
    vi.stubEnv('WXT_GOOGLE_CLIENT_SECRET', 'secret');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('renews with the refresh token and no Google page', async () => {
    let body = '';
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      body = String(init.body);
      return Response.json({ access_token: 'new', expires_in: 3599 });
    });

    const result = await refreshAccessToken({ email: 'a@gmail.com', refreshToken: 'rt' });
    expect(result?.token).toBe('new');
    expect(new URLSearchParams(body).get('grant_type')).toBe('refresh_token');
    expect(new URLSearchParams(body).get('refresh_token')).toBe('rt');
  });

  it('asks for Reconnect when Google revokes the refresh token', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error: 'invalid_grant' }, { status: 400 }));
    await expect(refreshAccessToken({ email: 'a@gmail.com', refreshToken: 'rt' })).resolves.toBeNull();
  });

  it('keeps the account connected when Google is unreachable', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(refreshAccessToken({ email: 'a@gmail.com', refreshToken: 'rt' })).rejects.toBeInstanceOf(
      TokenRefreshError,
    );
  });

  it('falls back to the silent flow for accounts without a refresh token', async () => {
    await expect(refreshAccessToken({ email: 'a@gmail.com' })).resolves.toBeNull();
  });

  it('treats a refresh token from another client as revoked', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error: 'invalid_client' }, { status: 401 }));
    await expect(refreshAccessToken({ email: 'a@gmail.com', refreshToken: 'rt' })).resolves.toBeNull();
    vi.stubGlobal('fetch', async () => Response.json({ error: 'unauthorized_client' }, { status: 400 }));
    await expect(refreshAccessToken({ email: 'a@gmail.com', refreshToken: 'rt' })).resolves.toBeNull();
  });

  it('refreshes with the custom pair when one is saved', async () => {
    store.customOAuth = { clientId: 'mine.apps.googleusercontent.com', clientSecret: 'mine-secret' };
    let body = '';
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      body = String(init.body);
      return Response.json({ access_token: 'new', expires_in: 3599 });
    });
    await refreshAccessToken({ email: 'a@gmail.com', refreshToken: 'rt' });
    expect(new URLSearchParams(body).get('client_id')).toBe('mine.apps.googleusercontent.com');
    expect(new URLSearchParams(body).get('client_secret')).toBe('mine-secret');
  });
});

describe('resolveClient', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    vi.stubEnv('WXT_GOOGLE_CLIENT_ID', 'client');
    vi.stubEnv('WXT_GOOGLE_CLIENT_SECRET', 'secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the custom pair when both fields are set', async () => {
    store.customOAuth = { clientId: 'mine', clientSecret: 'ms' };
    expect(await resolveClient()).toEqual({ clientId: 'mine', clientSecret: 'ms' });
  });

  it('uses the build-time pair when nothing is saved', async () => {
    expect(await resolveClient()).toEqual({ clientId: 'client', clientSecret: 'secret' });
  });

  it('uses the build-time pair when only the Client ID is saved', async () => {
    store.customOAuth = { clientId: 'mine', clientSecret: '' };
    expect(await resolveClient()).toEqual({ clientId: 'client', clientSecret: 'secret' });
  });

  it('is empty with no build-time pair and no custom pair', async () => {
    vi.stubEnv('WXT_GOOGLE_CLIENT_ID', '');
    vi.stubEnv('WXT_GOOGLE_CLIENT_SECRET', '');
    expect(await resolveClient()).toEqual({ clientId: '', clientSecret: '' });
  });
});
