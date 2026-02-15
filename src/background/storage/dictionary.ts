import { normalizeLemma } from '../../lib/domain-utils';

export interface DictEntry {
  lemma: string;
  rank: number;
  phonetic: string;
  meaning: string;
}

const POS_SPLIT_RE = /,\s*(?=[a-z]{1,5}\.)/;
const POS_PREFIX_RE = /^\s*[a-z]{1,5}\.\s*/i;

export function parseDictionary(text: string): Map<string, DictEntry> {
  const dict = new Map<string, DictEntry>();
  const lines = text.split(/\r?\n/);

  for (let i = 0; i + 2 < lines.length; i += 4) {
    const header = (lines[i] ?? '').trim();
    if (!header) continue;

    const parts = header.split(/\s+/);
    if (parts.length < 2) continue;

    const rank = parseInt(parts[parts.length - 1], 10);
    if (!Number.isFinite(rank)) continue;

    const lemma = normalizeLemma(parts[0]);
    if (!lemma) continue;

    const phonetic = (lines[i + 1] ?? '').trim();
    const meaning = (lines[i + 2] ?? '').trim();

    dict.set(lemma, { lemma, rank, phonetic, meaning });
  }

  return dict;
}

export function extractConciseMeaning(fullMeaning: string): string {
  const trimmed = fullMeaning?.trim();
  if (!trimmed) return '';

  const firstPos = trimmed.split(POS_SPLIT_RE)[0] ?? '';
  const bare = firstPos.replace(POS_PREFIX_RE, '').trim();
  if (!bare) return '';

  const first = bare.split('；')[0] ?? '';
  const clean = first.replace(/[（(][^）)]*[）)]/g, '').trim();
  return clean.length > 15 ? clean.slice(0, 15) : clean;
}

class DictionaryService {
  private dict: Map<string, DictEntry> | null = null;
  private loading: Promise<void> | null = null;
  private loadError: string | null = null;

  async ensureLoaded(): Promise<void> {
    if (this.dict) return;
    if (!this.loading) {
      this.loading = (async () => {
        const url = chrome.runtime.getURL('30k-explained.txt');
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Dictionary load failed: ${res.status}`);
        const text = await res.text();
        this.dict = parseDictionary(text);
        this.loadError = null;
        console.log(`[Traced] Dictionary loaded: ${this.dict.size} entries`);
      })().catch(err => {
        this.loadError = err instanceof Error ? err.message : String(err);
        console.error('[Traced] Dictionary load error:', this.loadError);
        throw err;
      }).finally(() => { this.loading = null; });
    }
    await this.loading;
  }

  get isLoaded(): boolean { return this.dict !== null; }
  get size(): number { return this.dict?.size ?? 0; }
  get lastError(): string | null { return this.loadError; }

  lookup(lemma: string): DictEntry | undefined {
    return this.dict?.get(normalizeLemma(lemma));
  }

  lookupMeaning(lemma: string): string | undefined {
    const entry = this.lookup(lemma);
    return entry ? extractConciseMeaning(entry.meaning) || undefined : undefined;
  }
}

export const dictionaryService = new DictionaryService();
