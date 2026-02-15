import { sendMessage } from '../lib/messaging';

interface PreloadEntry {
  promise: Promise<string>;
  result?: string;
  error?: string;
}

const preloadCache = new Map<string, PreloadEntry>();

export function preloadTranslation(word: string, contextSentence: string): void {
  const key = word.toLowerCase().trim();
  if (preloadCache.has(key)) return;

  const promise = sendMessage<unknown, { translatedText: string }>('TRANSLATE_SELECTION', {
    sourceText: word,
    contextSentence,
    mode: 'default',
  }).then(r => {
    const entry = preloadCache.get(key);
    if (entry) entry.result = r.translatedText;
    return r.translatedText;
  }).catch(err => {
    const entry = preloadCache.get(key);
    if (entry) entry.error = err instanceof Error ? err.message : 'Failed';
    throw err;
  });

  preloadCache.set(key, { promise });
}

export function getPreloaded(word: string): PreloadEntry | undefined {
  return preloadCache.get(word.toLowerCase().trim());
}

export function clearPreload(word: string): void {
  preloadCache.delete(word.toLowerCase().trim());
}
