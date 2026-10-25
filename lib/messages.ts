import type { Mode, PublicState, Settings } from './types';

export type ExtensionRequest =
  | { type: 'GET_STATE' }
  | { type: 'REFRESH_BILLING' }
  | { type: 'POLL' }
  | { type: 'SYNC'; accountEmail?: string }
  | { type: 'SAVE_ACCOUNT'; account: { email: string; token: string; expiresAt: number; refreshToken?: string } }
  | { type: 'REMOVE_ACCOUNT'; email: string }
  | { type: 'SET_ACCOUNT_MODE'; email: string; mode: Mode | null }
  | { type: 'SET_SETTINGS'; settings: Partial<Settings> }
  | { type: 'OTP_PAGE_DETECTED' }
  | { type: 'MARK_SEEN' }
  | { type: 'CLEAR_HISTORY' }
  | { type: 'ARCHIVE_HISTORY' }
  | { type: 'FILL_OTP'; code: string; autoSubmit: boolean }
  | { type: 'HAS_OTP_FIELD' }
  | { type: 'OFFSCREEN_COPY'; text: string };

export type ExtensionResponse =
  | { ok: true; state?: PublicState; copied?: boolean }
  | { ok: false; error: string };

export type FillResponse = { filled: boolean };

export type HasFieldResponse = { hasField: boolean };
