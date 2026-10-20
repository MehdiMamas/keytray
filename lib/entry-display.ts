import type { CodeClickAction, CodeEntry, PopupShows } from './types';

/** A link-only entry, or a code whose message also carried a link. */
function hasLink(entry: CodeEntry): boolean {
  return entry.kind === 'link' || Boolean(entry.url);
}

export function filterEntries(entries: CodeEntry[], shows: PopupShows): CodeEntry[] {
  if (shows === 'codes') return entries.filter((entry) => entry.kind !== 'link');
  if (shows === 'links') return entries.filter(hasLink);
  return entries;
}

/** What a click on a notification does. Only code notifications can copy. */
export function notificationClickAction(isLink: boolean, setting: CodeClickAction): 'open-link' | 'open-email' | 'copy' {
  if (isLink) return 'open-link';
  return setting === 'copy' ? 'copy' : 'open-email';
}
