import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({
  browser: {
    identity: {
      getRedirectURL: () => 'https://example.chromiumapp.org/',
      launchWebAuthFlow: vi.fn(async () => {
        throw new Error('interaction_required');
      }),
    },
  },
}));

const { refreshAccessToken, TokenRefreshError } = await import('~/lib/auth');

describe('refreshAccessToken', () => {
  beforeEach(() => {
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
});
