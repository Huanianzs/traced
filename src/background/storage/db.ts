import Dexie, { Table } from 'dexie';
import { normalizeLemma, calculateWeightedScore } from '../../lib/domain-utils';

// Entity types
export interface TraceEntity {
  traceId: string;
  createdAt: number;
  updatedAt: number;
  sourceText: string;
  contextSentence?: string;
  translatedText: string;
  styleMode: 'default' | 'poetry' | 'webnovel';
  pageUrl: string;
  pageHost: string;
  pageTitle?: string;
  faviconUrl?: string;
  locator?: {
    textQuote?: string;
    xpath?: string;
    startOffset?: number;
  };
  fingerprint: string;
}

export interface VocabEntity {
  vocabId: string;
  lemma: string;
  surface: string;
  language: string;
  meaning: string;
  sourceTraceId?: string;
  proficiency: 0 | 1 | 2 | 3 | 4 | 5;
  dueAt?: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  // Wordbank source fields
  sourceType?: 'manual' | 'wordbank' | 'import' | 'ai';
  sourceWordbankId?: string;
  firstSeenAt?: number;
  lastSeenAt?: number;
  // Smart highlight fields (Phase 4)
  familiarityScore?: number;      // Weighted familiarity score
  lastReviewDate?: number;        // Last review timestamp
  nextReviewDate?: number;        // Next review timestamp (SRS)
  reviewInterval?: number;        // Review interval in days
  isKnown?: boolean;              // Marked as known (hidden from highlights)
  scoreLocked?: boolean;          // Locked score (noise words, skip highlight)
  isTraced?: boolean;             // Actively traced word (2x scoring, highlight priority)
  noiseManaged?: boolean;         // Managed by noise-word rules
}

export interface EncounterEntity {
  encounterId: string;
  vocabId: string;
  surface: string;
  normalizedSurface: string;
  pageUrl: string;
  pageHost: string;
  pageTitle?: string;
  faviconUrl?: string;
  contextSentence?: string;
  locator?: TraceEntity['locator'];
  source: 'trace' | 'scan' | 'lookup' | 'manual' | 'import' | 'wordbank' | 'rate_known' | 'rate_familiar' | 'rate_unknown';
  createdAt: number;
  updatedAt: number;
  // Wordbank source fields
  sourceWordbankId?: string;
}

export interface SettingsKV {
  key: string;
  value: unknown;
  updatedAt: number;
}

export interface ProviderEntity {
  providerId: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
  enabled: boolean;
  available?: boolean;
  priority?: number;
  deletedAt?: number;
  updatedAt: number;
}

export interface PromptTemplate {
  templateId: string;
  mode: 'default' | 'poetry' | 'webnovel';
  name: string;
  systemPrompt: string;
  enabled: boolean;
  builtIn: boolean;
  updatedAt: number;
}

// Wordbank types
export type WordbankCode = 'daily' | 'programming' | 'cet4' | 'cet6' | 'gaokao' | 'postgrad' | 'primary' | 'top10k' | 'noise' | 'custom';

export interface WordbankEntity {
  wordbankId: string;
  code: WordbankCode;
  name: string;
  description?: string;
  language: string;
  builtIn: boolean;
  enabledByDefault: boolean;
  version: string;
  wordCount: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface WordbankWordEntity {
  wordId: string;
  wordbankId: string;
  lemma: string;
  surface: string;
  normalized: string;
  language: string;
  rank?: number;
  createdAt: number;
}

export interface UserWordbankEntity {
  userWordbankId: string;
  wordbankId: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface LemmaStatEntity {
  lemmaStatId: string;
  lemma: string;
  normalizedLemma: string;
  language: string;
  totalCount: number;
  pageCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  lastPageUrl?: string;
  lastPageHost?: string;
  inWordbank: boolean;
  sourceMask: number;
  dictRank?: number;
  promotedVocabId?: string;
  promotedAt?: number;
  promotionReason?: 'threshold' | 'manual' | 'wordbank';
  cooldownUntil?: number;
  updatedAt: number;
}

// Database class
class TracedDB extends Dexie {
  traces!: Table<TraceEntity, string>;
  vocabulary!: Table<VocabEntity, string>;
  encounters!: Table<EncounterEntity, string>;
  settings!: Table<SettingsKV, string>;
  providers!: Table<ProviderEntity, string>;
  prompts!: Table<PromptTemplate, string>;
  wordbanks!: Table<WordbankEntity, string>;
  wordbankWords!: Table<WordbankWordEntity, string>;
  userWordbanks!: Table<UserWordbankEntity, string>;
  lemmaStats!: Table<LemmaStatEntity, string>;

  constructor() {
    super('TracedDB');
    this.version(1).stores({
      traces: '&traceId, createdAt, [pageHost+createdAt], fingerprint, sourceText',
      vocabulary: '&vocabId, [lemma+language], proficiency, dueAt, updatedAt',
      settings: '&key',
      providers: '&providerId, enabled',
      prompts: '&templateId, mode, enabled',
    });

    this.version(2).stores({
      traces: '&traceId, createdAt, [pageHost+createdAt], fingerprint, sourceText',
      vocabulary: '&vocabId, [lemma+language], proficiency, dueAt, updatedAt, deletedAt',
      encounters: '&encounterId, vocabId, [vocabId+createdAt], [pageHost+createdAt], pageUrl, createdAt',
      settings: '&key',
      providers: '&providerId, enabled',
      prompts: '&templateId, mode, enabled',
    }).upgrade(async (tx) => {
      const traces = await tx.table('traces').toArray() as TraceEntity[];
      const vocabularyTable = tx.table('vocabulary');
      const encountersTable = tx.table('encounters');
      const byKey = new Map<string, string>();

      for (const trace of traces) {
        const lemma = normalizeLemma(trace.sourceText);
        const key = `${lemma}|en`;
        let vocabId = byKey.get(key);

        if (!vocabId) {
          const existing = await vocabularyTable.where('[lemma+language]').equals([lemma, 'en']).first() as VocabEntity | undefined;
          if (existing) {
            vocabId = existing.vocabId;
          } else {
            vocabId = crypto.randomUUID();
            const now = Date.now();
            await vocabularyTable.add({
              vocabId, lemma, surface: trace.sourceText, language: 'en',
              meaning: '', proficiency: 0, sourceTraceId: trace.traceId,
              createdAt: now, updatedAt: now
            } as VocabEntity);
          }
          byKey.set(key, vocabId);
        }

        await encountersTable.add({
          encounterId: crypto.randomUUID(),
          vocabId,
          surface: trace.sourceText,
          normalizedSurface: lemma,
          pageUrl: trace.pageUrl,
          pageHost: trace.pageHost,
          pageTitle: trace.pageTitle,
          faviconUrl: trace.faviconUrl,
          contextSentence: trace.contextSentence,
          locator: trace.locator,
          source: 'trace',
          createdAt: trace.createdAt,
          updatedAt: trace.createdAt
        } as EncounterEntity);
      }
    });

    // Version 3: Add wordbank tables
    this.version(3).stores({
      traces: '&traceId, createdAt, [pageHost+createdAt], fingerprint, sourceText',
      vocabulary: '&vocabId, [lemma+language], proficiency, dueAt, updatedAt, deletedAt, sourceWordbankId',
      encounters: '&encounterId, vocabId, [vocabId+createdAt], [pageHost+createdAt], pageUrl, createdAt, sourceWordbankId',
      settings: '&key',
      providers: '&providerId, enabled',
      prompts: '&templateId, mode, enabled',
      wordbanks: '&wordbankId, code, language, builtIn',
      wordbankWords: '&wordId, wordbankId, [wordbankId+normalized], [wordbankId+lemma]',
      userWordbanks: '&userWordbankId, wordbankId, enabled'
    }).upgrade(async (tx) => {
      const now = Date.now();
      const wordbanksTable = tx.table('wordbanks');
      const userWordbanksTable = tx.table('userWordbanks');

      const builtInWordbanks: WordbankEntity[] = [
        { wordbankId: 'wb_daily', code: 'daily', name: '日常交流', language: 'en', builtIn: true, enabledByDefault: false, version: '1.0.0', wordCount: 0, createdAt: now, updatedAt: now },
        { wordbankId: 'wb_programming', code: 'programming', name: '编程词汇', language: 'en', builtIn: true, enabledByDefault: false, version: '1.0.0', wordCount: 0, createdAt: now, updatedAt: now },
        { wordbankId: 'wb_cet4', code: 'cet4', name: '四级词汇', language: 'en', builtIn: true, enabledByDefault: false, version: '1.0.0', wordCount: 0, createdAt: now, updatedAt: now },
        { wordbankId: 'wb_cet6', code: 'cet6', name: '六级词汇', language: 'en', builtIn: true, enabledByDefault: false, version: '1.0.0', wordCount: 0, createdAt: now, updatedAt: now },
        { wordbankId: 'wb_gaokao', code: 'gaokao', name: '高考词汇', language: 'en', builtIn: true, enabledByDefault: false, version: '1.0.0', wordCount: 0, createdAt: now, updatedAt: now },
        { wordbankId: 'wb_primary', code: 'primary', name: '小学词汇', language: 'en', builtIn: true, enabledByDefault: false, version: '1.0.0', wordCount: 0, createdAt: now, updatedAt: now },
        { wordbankId: 'wb_postgrad', code: 'postgrad', name: '考研词汇', language: 'en', builtIn: true, enabledByDefault: false, version: '1.0.0', wordCount: 0, createdAt: now, updatedAt: now },
        { wordbankId: 'wb_top10k', code: 'top10k', name: '词频前一万', language: 'en', builtIn: true, enabledByDefault: false, version: '1.0.0', wordCount: 0, createdAt: now, updatedAt: now },
      ];

      for (const wb of builtInWordbanks) {
        await wordbanksTable.add(wb);
        await userWordbanksTable.add({
          userWordbankId: crypto.randomUUID(),
          wordbankId: wb.wordbankId,
          enabled: wb.enabledByDefault,
          createdAt: now,
          updatedAt: now
        });
      }
    });

    // Version 4: Add smart highlight fields (familiarityScore, isKnown, SRS fields)
    this.version(4).stores({
      traces: '&traceId, createdAt, [pageHost+createdAt], fingerprint, sourceText',
      vocabulary: '&vocabId, [lemma+language], proficiency, dueAt, updatedAt, deletedAt, sourceWordbankId, isKnown, nextReviewDate',
      encounters: '&encounterId, vocabId, [vocabId+createdAt], [pageHost+createdAt], pageUrl, createdAt, sourceWordbankId',
      settings: '&key',
      providers: '&providerId, enabled',
      prompts: '&templateId, mode, enabled',
      wordbanks: '&wordbankId, code, language, builtIn',
      wordbankWords: '&wordId, wordbankId, [wordbankId+normalized], [wordbankId+lemma]',
      userWordbanks: '&userWordbankId, wordbankId, enabled'
    }).upgrade(async (tx) => {
      // Initialize familiarityScore for existing vocabulary based on encounters
      const vocabTable = tx.table('vocabulary');
      const encountersTable = tx.table('encounters');
      const allVocab = await vocabTable.toArray();

      for (const vocab of allVocab) {
        const encounters = await encountersTable.where('vocabId').equals(vocab.vocabId).toArray();
        const familiarityScore = calculateWeightedScore(encounters, 1);

        await vocabTable.update(vocab.vocabId, {
          familiarityScore,
          isKnown: vocab.proficiency >= 5,
          lastReviewDate: vocab.updatedAt,
          nextReviewDate: Date.now() + 24 * 60 * 60 * 1000, // Default: review tomorrow
          reviewInterval: 1
        });
      }
    });

    // Version 5: Add scoreLocked index for noise words
    this.version(5).stores({
      traces: '&traceId, createdAt, [pageHost+createdAt], fingerprint, sourceText',
      vocabulary: '&vocabId, [lemma+language], proficiency, dueAt, updatedAt, deletedAt, sourceWordbankId, isKnown, nextReviewDate, scoreLocked',
      encounters: '&encounterId, vocabId, [vocabId+createdAt], [pageHost+createdAt], pageUrl, createdAt, sourceWordbankId',
      settings: '&key',
      providers: '&providerId, enabled',
      prompts: '&templateId, mode, enabled',
      wordbanks: '&wordbankId, code, language, builtIn',
      wordbankWords: '&wordId, wordbankId, [wordbankId+normalized], [wordbankId+lemma]',
      userWordbanks: '&userWordbankId, wordbankId, enabled'
    });

    // Version 6: Add isTraced field, backfill from trace encounters
    this.version(6).stores({
      traces: '&traceId, createdAt, [pageHost+createdAt], fingerprint, sourceText',
      vocabulary: '&vocabId, [lemma+language], proficiency, dueAt, updatedAt, deletedAt, sourceWordbankId, isKnown, nextReviewDate, scoreLocked, isTraced',
      encounters: '&encounterId, vocabId, [vocabId+createdAt], [pageHost+createdAt], pageUrl, createdAt, sourceWordbankId',
      settings: '&key',
      providers: '&providerId, enabled',
      prompts: '&templateId, mode, enabled',
      wordbanks: '&wordbankId, code, language, builtIn',
      wordbankWords: '&wordId, wordbankId, [wordbankId+normalized], [wordbankId+lemma]',
      userWordbanks: '&userWordbankId, wordbankId, enabled'
    }).upgrade(async (tx) => {
      const encountersTable = tx.table('encounters');
      const vocabTable = tx.table('vocabulary');
      const traceEncs = await encountersTable
        .filter((e: EncounterEntity) => e.source === 'trace')
        .toArray() as EncounterEntity[];
      const tracedIds = [...new Set(traceEncs.map(e => e.vocabId))];
      for (const vid of tracedIds) {
        await vocabTable.update(vid, { isTraced: true });
      }
    });

    // Version 7: Remove redundant lemma index from wordbankWords
    this.version(7).stores({
      traces: '&traceId, createdAt, [pageHost+createdAt], fingerprint, sourceText',
      vocabulary: '&vocabId, [lemma+language], proficiency, dueAt, updatedAt, deletedAt, sourceWordbankId, isKnown, nextReviewDate, scoreLocked, isTraced',
      encounters: '&encounterId, vocabId, [vocabId+createdAt], [pageHost+createdAt], pageUrl, createdAt, sourceWordbankId',
      settings: '&key',
      providers: '&providerId, enabled',
      prompts: '&templateId, mode, enabled',
      wordbanks: '&wordbankId, code, language, builtIn',
      wordbankWords: '&wordId, wordbankId, [wordbankId+normalized]',
      userWordbanks: '&userWordbankId, wordbankId, enabled'
    });

    // Version 8: Add lemmaStats table for environment-first word tracking
    this.version(8).stores({
      traces: '&traceId, createdAt, [pageHost+createdAt], fingerprint, sourceText',
      vocabulary: '&vocabId, [lemma+language], proficiency, dueAt, updatedAt, deletedAt, sourceWordbankId, isKnown, nextReviewDate, scoreLocked, isTraced',
      encounters: '&encounterId, vocabId, [vocabId+createdAt], [pageHost+createdAt], pageUrl, createdAt, sourceWordbankId',
      settings: '&key',
      providers: '&providerId, enabled',
      prompts: '&templateId, mode, enabled',
      wordbanks: '&wordbankId, code, language, builtIn',
      wordbankWords: '&wordId, wordbankId, [wordbankId+normalized]',
      userWordbanks: '&userWordbankId, wordbankId, enabled',
      lemmaStats: '&lemmaStatId, &normalizedLemma, [inWordbank+totalCount], [lastSeenAt+totalCount], totalCount, lastSeenAt, dictRank'
    });

    // Version 9: Add compound index for encounters timeline queries
    this.version(9).stores({
      traces: '&traceId, createdAt, [pageHost+createdAt], fingerprint, sourceText',
      vocabulary: '&vocabId, [lemma+language], proficiency, dueAt, updatedAt, deletedAt, sourceWordbankId, isKnown, nextReviewDate, scoreLocked, isTraced',
      encounters: '&encounterId, vocabId, [vocabId+createdAt], [pageHost+createdAt], pageUrl, createdAt, sourceWordbankId, [normalizedSurface+createdAt]',
      settings: '&key',
      providers: '&providerId, enabled',
      prompts: '&templateId, mode, enabled',
      wordbanks: '&wordbankId, code, language, builtIn',
      wordbankWords: '&wordId, wordbankId, [wordbankId+normalized]',
      userWordbanks: '&userWordbankId, wordbankId, enabled',
      lemmaStats: '&lemmaStatId, &normalizedLemma, [inWordbank+totalCount], [lastSeenAt+totalCount], totalCount, lastSeenAt, dictRank'
    });
  }
}

export const db = new TracedDB();

export { normalizeLemma } from '../../lib/domain-utils';

// Hash function for fingerprint
export function createFingerprint(text: string, url: string): string {
  const str = `${text.toLowerCase().trim()}|${url}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
