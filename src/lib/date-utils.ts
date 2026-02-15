import type { Locale } from './i18n';

export function formatRelativeDate(
  timestamp: number,
  t: (key: string, locale?: Locale) => string,
  locale?: Locale
): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return t('sidepanel.today', locale);
  if (days === 1) return t('sidepanel.yesterday', locale);
  if (days < 7) return `${days} ${t('sidepanel.daysAgo', locale)}`;
  return date.toLocaleDateString();
}

export function groupByDate<T extends { createdAt: number }>(
  items: T[]
): { date: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  for (const e of items) {
    const d = new Date(e.createdAt).toDateString();
    const label = d === today ? '今天' : d === yesterday ? '昨天' : new Date(e.createdAt).toLocaleDateString();
    const list = groups.get(label) || [];
    list.push(e);
    groups.set(label, list);
  }

  return Array.from(groups.entries()).map(([date, items]) => ({ date, items }));
}
