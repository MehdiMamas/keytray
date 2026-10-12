import { browser } from 'wxt/browser';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface SignedInAccount {
  email: string;
  token: string;
  expiresAt: number;
  /** Long-lived. Lets the background worker renew access without any Google page. */
  refreshToken?: string;
}

/** Renewal failed for a reason that may pass (offline, Google 5xx). The account stays connected. */
export class TokenRefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenRefreshError';
  }
}

export function googleClientId(): string {
  return import.meta.env.WXT_GOOGLE_CLIENT_ID ?? '';
}

function googleClientSecret(): string {
  return import.meta.env.WXT_GOOGLE_CLIENT_SECRET ?? '';
}

/**
 * Interactive sign-in. Call this from the options page so the click gesture is intact.
 * Uses the authorization code flow so Google returns a refresh token.
 */
export async function signInInteractive(loginHint?: string): Promise<SignedInAccount> {
  const clientId = googleClientId();
  if (!clientId || !googleClientSecret()) {
    throw new Error('Missing Google client id or secret. Add them to .env and rebuild.');
  }
  const verifier = randomVerifier();
  const responseUrl = await launch({
    response_type: 'code',
    prompt: 'consent select_account',
    access_type: 'offline',
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
    ...(loginHint ? { login_hint: loginHint } : {}),
  }, true);
  const params = new URL(responseUrl).searchParams;
  const error = params.get('error');
  if (error) throw new Error(params.get('error_description') || error);
  const code = params.get('code');
  if (!code) throw new Error('Google did not return an authorization code');

  const tokens = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: browser.identity.getRedirectURL(),
  });
  if (!tokens.ok) throw new Error(tokens.error);
  const email = await fetchEmail(tokens.token);
  return { email, token: tokens.token, expiresAt: tokens.expiresAt, refreshToken: tokens.refreshToken };
}

/**
 * Background renewal. Returns null if the user must click Reconnect.
 * Throws TokenRefreshError when the failure may be temporary.
 */
export async function refreshAccessToken(account: {
  email: string;
  refreshToken?: string;
}): Promise<{ token: string; expiresAt: number } | null> {
  if (!googleClientId()) return null;
  if (account.refreshToken && googleClientSecret()) {
    const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: account.refreshToken });
    if (tokens.ok) return { token: tokens.token, expiresAt: tokens.expiresAt };
    if (tokens.revoked) {
      console.warn('[Gmail OTP] refresh token rejected', account.email, tokens.error);
      return null;
    }
    throw new TokenRefreshError(tokens.error);
  }
  return silentImplicitRefresh(account.email);
}

/** Accounts connected before refresh tokens. Works only while Google's session cookie allows it. */
async function silentImplicitRefresh(email: string): Promise<{ token: string; expiresAt: number } | null> {
  try {
    const responseUrl = await launch({ response_type: 'token', prompt: 'none', login_hint: email }, false);
    const params = new URLSearchParams(new URL(responseUrl).hash.replace(/^#/, ''));
    const error = params.get('error');
    if (error) throw new Error(error);
    const token = params.get('access_token');
    if (!token) throw new Error('no access token');
    return { token, expiresAt: Date.now() + Number(params.get('expires_in') || 3600) * 1000 };
  } catch (error) {
    console.warn('[Gmail OTP] silent sign-in failed', email, error);
    return null;
  }
}

type TokenResult =
  | { ok: true; token: string; expiresAt: number; refreshToken?: string }
  | { ok: false; error: string; revoked: boolean };

async function tokenRequest(fields: Record<string, string>): Promise<TokenResult> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: googleClientId(),
        client_secret: googleClientSecret(),
        ...fields,
      }),
    });
  } catch {
    return { ok: false, error: 'Could not reach Google', revoked: false };
  }
  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !data.access_token) {
    const error = data.error_description || data.error || `Google token endpoint ${response.status}`;
    return { ok: false, error, revoked: data.error === 'invalid_grant' };
  }
  return {
    ok: true,
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    refreshToken: data.refresh_token,
  };
}

async function launch(params: Record<string, string>, interactive: boolean): Promise<string> {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', googleClientId());
  url.searchParams.set('redirect_uri', browser.identity.getRedirectURL());
  url.searchParams.set('scope', SCOPES);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const responseUrl = await browser.identity.launchWebAuthFlow({ url: url.href, interactive });
  if (!responseUrl) throw new Error('Google sign-in was cancelled');
  return responseUrl;
}

function randomVerifier(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function fetchEmail(token: string): Promise<string> {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('Could not read the Google account email');
  const data = (await response.json()) as { email?: string };
  if (!data.email) throw new Error('Google account has no email address');
  return data.email;
}
