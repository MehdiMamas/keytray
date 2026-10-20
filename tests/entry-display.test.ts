import { describe, expect, it } from 'vitest';
import { filterEntries, notificationClickAction } from '~/lib/entry-display';
import { DEFAULT_SETTINGS, type CodeEntry } from '~/lib/types';

const base = { messageId: 'm', account: 'a@x.com', from: 'S', subject: 's', receivedAt: 1 };
const legacyCode: CodeEntry = { ...base, id: '1', code: '123456' };
const code: CodeEntry = { ...base, id: '2', code: '654321', kind: 'code' };
const codeWithLink: CodeEntry = { ...base, id: '3', code: '111111', kind: 'code', url: 'https://x.com/v' };
const link: CodeEntry = { ...base, id: '4', code: 'x.com', kind: 'link', url: 'https://x.com/v' };
const all = [legacyCode, code, codeWithLink, link];

describe('filterEntries', () => {
  it('keeps everything for all', () => {
    expect(filterEntries(all, 'all')).toEqual(all);
  });

  it('codes only drops link entries and keeps old rows without a kind', () => {
    expect(filterEntries(all, 'codes').map((e) => e.id)).toEqual(['1', '2', '3']);
  });

  it('links only keeps link entries and codes that carry a link', () => {
    expect(filterEntries(all, 'links').map((e) => e.id)).toEqual(['3', '4']);
  });
});

describe('notificationClickAction', () => {
  it('defaults keep opening the email', () => {
    expect(DEFAULT_SETTINGS.popupShows).toBe('all');
    expect(notificationClickAction(false, DEFAULT_SETTINGS.codeClickAction)).toBe('open-email');
  });

  it('copies a code when chosen', () => {
    expect(notificationClickAction(false, 'copy')).toBe('copy');
  });

  it('link notifications always open the link', () => {
    expect(notificationClickAction(true, 'copy')).toBe('open-link');
    expect(notificationClickAction(true, 'open')).toBe('open-link');
  });
});
