export type Mode = 'autofill' | 'autocopy' | 'nothing';

export interface Account {
  email: string;
  token?: string;
  expiresAt?: number;
  /** Google OAuth refresh token. Missing for accounts connected before 0.5.0. */
  refreshToken?: string;
  historyId?: string;
  mode?: Mode;
  needsReauth?: boolean;
  /** Last poll failure for this account. Cleared on the next successful poll. */
  syncError?: string;
}

export type EntryKind = 'code' | 'link';

export interface CodeEntry {
  id: string;
  messageId: string;
  account: string;
  /** Digits for a code. Host name for a link-only entry. */
  code: string;
  from: string;
  subject: string;
  receivedAt: number;
  /** Missing on rows saved before link support. Those are codes. */
  kind?: EntryKind;
  /** Verification or sign-in URL. Present on link entries, and on a code when the same message has both. */
  url?: string;
}

export type PopupShows = 'all' | 'codes' | 'links';
export type CodeClickAction = 'open' | 'copy';

export interface Settings {
  defaultMode: Mode;
  notifications: boolean;
  fastPoll: boolean;
  /** Press the page's submit button after a fill. Off by default. */
  autoSubmit: boolean;
  /** Inline "Fill 123456" chip on detected fields. */
  showFillChip: boolean;
  /** Which kinds of entries the popup list shows. */
  popupShows: PopupShows;
  /** What clicking a code notification does. Link notifications always open the link. */
  codeClickAction: CodeClickAction;
  /** Let a local agent ask Keytray to fill a code or open a link. Off by default. */
  agentEnabled: boolean;
  /** Sites the agent may act on: exact host or any subdomain. */
  agentAllowlist: string[];
}

export interface PersistedState {
  accounts: Account[];
  codes: CodeEntry[];
  processedIds: string[];
  settings: Settings;
  unseen: number;
  lastSyncedAt: number | null;
}

export interface PublicAccount {
  email: string;
  mode?: Mode;
  needsReauth?: boolean;
  syncError?: string;
  /** False for accounts connected before refresh tokens. One Reconnect fixes it. */
  staysSignedIn: boolean;
}

export interface PublicState {
  accounts: PublicAccount[];
  codes: CodeEntry[];
  settings: Settings;
  unseen: number;
  lastSyncedAt: number | null;
  /** One-time unlock for more than one Gmail account. */
  paid: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultMode: 'nothing',
  notifications: true,
  fastPoll: true,
  autoSubmit: false,
  showFillChip: true,
  popupShows: 'all',
  codeClickAction: 'open',
  agentEnabled: false,
  agentAllowlist: ['github.com', 'google.com', 'vercel.com', 'apple.com'],
};

export const EMPTY_STATE: PersistedState = {
  accounts: [],
  codes: [],
  processedIds: [],
  settings: DEFAULT_SETTINGS,
  unseen: 0,
  lastSyncedAt: null,
};

export const CODE_MAX_AGE_MS = 10 * 60 * 1000;
export const MAX_CODES = 50;
export const MAX_PROCESSED_IDS = 400;
