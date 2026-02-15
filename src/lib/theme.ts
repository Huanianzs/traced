const THEME_KEY = 'traced_theme';

export function isDark(): boolean {
  return localStorage.getItem(THEME_KEY) === 'dark';
}

export function setDark(dark: boolean): void {
  localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  // Broadcast to other extension pages via chrome.storage
  chrome.storage.local.set({ theme: dark ? 'dark' : 'light' });
}

export function onThemeChange(callback: (dark: boolean) => void): () => void {
  const handler = (changes: { [key: string]: chrome.storage.StorageChange }) => {
    if (changes.theme) {
      callback(changes.theme.newValue === 'dark');
    }
  };
  chrome.storage.local.onChanged.addListener(handler);
  return () => chrome.storage.local.onChanged.removeListener(handler);
}

import { PROFICIENCY_BADGE_CLASSES, PROFICIENCY_DOT_CLASSES, PROFICIENCY_TEXT_CLASSES } from './constants';

export function getProficiencyColor(score: number): string {
  if (score <= 33) return PROFICIENCY_BADGE_CLASSES.red;
  if (score <= 66) return PROFICIENCY_BADGE_CLASSES.amber;
  return PROFICIENCY_BADGE_CLASSES.green;
}

export function getProficiencyDotColor(score: number): string {
  if (score <= 33) return PROFICIENCY_DOT_CLASSES.red;
  if (score <= 66) return PROFICIENCY_DOT_CLASSES.amber;
  return PROFICIENCY_DOT_CLASSES.green;
}

export function getProficiencyTextColor(level: number): string {
  if (level <= 1) return PROFICIENCY_TEXT_CLASSES.red;
  if (level <= 3) return PROFICIENCY_TEXT_CLASSES.amber;
  return PROFICIENCY_TEXT_CLASSES.green;
}
