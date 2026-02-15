import { ProviderEntity, PromptTemplate } from '../storage/db';

export const VIRTUAL_ENV_WORDBANK_ID = '__env__';

// Protocol types for message passing
export interface Envelope<T = unknown> {
  protocolVersion: '1.0.0';
  requestId: string;
  source: 'content-script' | 'popup' | 'sidepanel' | 'background';
  target: 'background';
  type: MessageType;
  timestamp: number;
  payload: T;
}

export type MessageType =
  | 'TRANSLATE_SELECTION'
  | 'UPSERT_VOCAB'
  | 'GET_SETTINGS'
  | 'UPDATE_SETTINGS'
  | 'SAVE_TRACE'
  | 'GET_TRACES'
  | 'DELETE_TRACE'
  | 'GET_ALL_VOCAB'
  | 'GET_SCANNED_TRACES' // Content script direct listener (not routed)
  | 'GET_VOCAB_LIST'
  | 'RECORD_ENCOUNTER'
  | 'GET_WORD_ENCOUNTERS'
  | 'SCAN_PAGE_WORDS'
  | 'DELETE_VOCAB'
  | 'CHECK_VOCAB'
  | 'DELETE_ENCOUNTER'
  | 'OPEN_SIDEPANEL'
  | 'MARK_MASTERED'
  | 'RATE_WORD'
  | 'GET_HIGHLIGHT_SELECTION'
  | 'SHORTCUT_ACTION'
  // Wordbank messages
  | 'LIST_WORDBANKS'
  | 'CREATE_WORDBANK'
  | 'DELETE_WORDBANK'
  | 'GET_USER_WORDBANKS'
  | 'UPSERT_USER_WORDBANKS'
  | 'GET_WORDBANK_STATS'
  | 'IMPORT_WORDBANK_WORDS'
  | 'GET_WORDBANK_WORDS'
  | 'UNLOCK_NOISE_WORD'
  | 'TRANSLATE_TRACE'
  | 'BATCH_TRANSLATE_WORDS'
  | 'TOGGLE_TRACE_WORD'
  | 'DRAW_CARD'
  | 'DRAW_TIMELINE_CARD'
  | 'GET_GIANT_WORDBANK'
  | 'GET_WEEKLY_HIGHLIGHTS'
  | 'CLEANUP_OLD_ENCOUNTERS'
  | 'GET_TRACED_WORDS'
  | 'DEV_DEBUG';

export type ApiResult<T> =
  | { ok: true; requestId: string; data: T }
  | { ok: false; requestId: string; error: ErrorPayload };

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTH_ERROR'
  | 'RATE_LIMIT_ERROR'
  | 'TIMEOUT_ERROR'
  | 'TRANSIENT_NETWORK_ERROR'
  | 'PROVIDER_ERROR'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

// Payload types
export interface LocatorPayload {
  textQuote?: string;
  xpath?: string;
  startOffset?: number;
}

export interface UpsertVocabPayload {
  vocabId?: string;
  lemma: string;
  surface?: string;
  language?: string;
  meaning?: string;
  proficiency?: 0 | 1 | 2 | 3 | 4 | 5;
  sourceTraceId?: string;
}

export interface GetVocabListPayload {
  limit?: number;
  offset?: number;
  search?: string;
  includeDeleted?: boolean;
  vocabFilter?: 'all' | 'noise' | 'normal' | 'traced';
}

export interface VocabListItem {
  vocabId: string;
  lemma: string;
  surface: string;
  language: string;
  meaning: string;
  proficiency: 0 | 1 | 2 | 3 | 4 | 5;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  encounterCount: number;
  weightedScore: number;
  lastEncounterAt?: number;
  scoreLocked?: boolean;
  isTraced?: boolean;
  isCold?: boolean;
}

export interface GetVocabListResult {
  items: VocabListItem[];
  total: number;
}

export interface RecordEncounterPayload {
  vocabId?: string;
  word?: string;
  language?: string;
  pageUrl: string;
  pageTitle?: string;
  faviconUrl?: string;
  contextSentence?: string;
  locator?: LocatorPayload;
  source?: 'trace' | 'scan' | 'lookup' | 'manual' | 'import' | 'wordbank' | 'rate_known' | 'rate_familiar' | 'rate_unknown';
  sourceWordbankId?: string;
}

export interface RateWordPayload {
  vocabId: string;
  rating: 'known' | 'familiar' | 'unknown';
}

export interface ToggleTraceWordPayload {
  vocabId: string;
  traced: boolean;
}

export interface ToggleTraceWordResult {
  success: true;
  vocabId: string;
  isTraced: boolean;
  activeTraceCount: number;
}

export interface ShortcutActionPayload {
  action: 'toggle-word-translation' | 'toggle-paragraph-translation';
  source: 'content-enforced' | 'commands-api' | 'popup';
  pageUrl?: string;
}

export interface GetHighlightSelectionPayload {
  matches: VocabItem[];
}

export interface DrawCardPayload {
  count?: number;        // default 10
  mode?: 'shuffle' | 'auto';   // default 'shuffle'
  excludeIds?: string[];
  seed?: number;         // optional, for testing
}

export interface DrawCardResult {
  cards: Array<{
    vocabId: string;
    lemma: string;
    surface: string;
    meaning: string;
    weightedScore: number;
    isTraced: boolean;
    priority: number;
    contextSentence?: string;
    pageTitle?: string;
  }>;
}

export interface VocabItem {
  vocabId: string;
  lemma: string;
  surface: string;
  proficiency: number;
  encounterCount: number;
  weightedScore: number;
  nextReviewDate?: number;
  isKnown?: boolean;
  scoreLocked?: boolean;
  isTraced?: boolean;
  sourceWordbankId?: string;
}

export interface HighlightSelectionResult {
  highlighted: VocabItem[];
  sidebar: VocabItem[];
}

export interface GetWordEncountersPayload {
  vocabId: string;
  limit?: number;
  offset?: number;
  pageHost?: string;
  pageUrl?: string;
}

export interface EncounterDTO {
  encounterId: string;
  vocabId: string;
  surface: string;
  pageUrl: string;
  pageHost: string;
  pageTitle?: string;
  contextSentence?: string;
  locator?: LocatorPayload;
  source: 'trace' | 'scan' | 'lookup' | 'manual' | 'import' | 'wordbank' | 'rate_known' | 'rate_familiar' | 'rate_unknown';
  sourceWordbankId?: string;
  createdAt: number;
}

export interface GetWordEncountersResult {
  encounters: EncounterDTO[];
  total: number;
}

export interface ScanPageWordsPayload {
  pageUrl: string;
  pageTitle?: string;
  faviconUrl?: string;
  language?: string;
  tokens?: string[];
  textContent?: string;
  sentences?: string[];
  record?: boolean;
}

export interface ScanPageWordsResultItem {
  vocabId: string;
  lemma: string;
  surface: string;
  proficiency: 0 | 1 | 2 | 3 | 4 | 5;
  encounterCount: number;
  weightedScore: number;
  presentCount: number;
  nextReviewDate?: number;
  isKnown?: boolean;
  scoreLocked?: boolean;
  isTraced?: boolean;
  sourceWordbankId?: string;
  priority?: 'high' | 'normal';
  source?: 'wordbank' | 'environment' | 'traced';
}

export interface ScanPageWordsStats {
  coverage: number;
  mastered: number;
  topMissedWords: Array<{ lemma: string; source: string; presentCount: number; encounterCount: number }>;
}

export interface ScanPageWordsResult {
  matches: ScanPageWordsResultItem[];
  stats: ScanPageWordsStats;
}

export interface BatchTranslateWordsPayload {
  words: Array<{ lemma: string; vocabId?: string }>;
  mode?: 'smart' | 'local' | 'api';
}

export interface BatchTranslateWordsResult {
  translations: Record<string, { meaning: string; source: 'dictionary' | 'vocab' | 'api' | 'trace' }>;
}

// Helper to create envelope
export function createEnvelope<T>(
  type: MessageType,
  payload: T,
  source: Envelope['source'] = 'content-script'
): Envelope<T> {
  return {
    protocolVersion: '1.0.0',
    requestId: crypto.randomUUID(),
    source,
    target: 'background',
    type,
    timestamp: Date.now(),
    payload,
  };
}

// Wordbank payload types
export interface ListWordbanksPayload {
  language?: string;
  includeDeleted?: boolean;
}

export interface CreateWordbankPayload {
  name: string;
  description?: string;
  language?: string;
}

export interface DeleteWordbankPayload {
  wordbankId: string;
}

export interface GetUserWordbanksPayload {}

export interface UpsertUserWordbanksPayload {
  selections: Array<{
    wordbankId: string;
    enabled: boolean;
  }>;
}

export interface GetWordbankStatsPayload {
  wordbankIds?: string[];
}

export interface ImportWordbankWordsPayload {
  wordbankId: string;
  words: Array<{
    lemma: string;
    surface: string;
    rank?: number;
  }>;
}

export interface WordbankDTO {
  wordbankId: string;
  code: string;
  name: string;
  description?: string;
  language: string;
  builtIn: boolean;
  wordCount: number;
  enabled: boolean;
}

export interface WordbankStatsItem {
  wordbankId: string;
  code: string;
  name: string;
  total: number;
  encountered: number;
  mastered: number;
  learning: number;
  newCount: number;
  masteryRate: number;
}

export interface GetWordbankStatsResult {
  items: WordbankStatsItem[];
  summary: {
    totalVocabulary: number;
    totalMastered: number;
    overallMasteryRate: number;
  };
}

export interface GetWordbankWordsPayload {
  wordbankId: string;
  limit?: number;
  offset?: number;
  filter?: 'all' | 'encountered' | 'not_encountered' | 'mastered' | 'learning';
  sortBy?: 'rank' | 'proficiency' | 'encounters';
  sortOrder?: 'asc' | 'desc';
}

export interface WordbankWordDTO {
  wordId: string;
  lemma: string;
  surface: string;
  rank?: number;
  // Vocabulary data if encountered
  vocabId?: string;
  proficiency?: 0 | 1 | 2 | 3 | 4 | 5;
  encounterCount?: number;
  lastSeenAt?: number;
}

export interface GetWordbankWordsResult {
  items: WordbankWordDTO[];
  total: number;
  filteredTotal: number;
}

// --- traces.ts payloads ---
export interface SaveTracePayload {
  sourceText: string;
  contextSentence?: string;
  translatedText: string;
  styleMode: 'default' | 'poetry' | 'webnovel';
  pageUrl: string;
  pageTitle?: string;
  faviconUrl?: string;
  locator?: LocatorPayload;
}

export interface GetTracesPayload {
  limit?: number;
  offset?: number;
  search?: string;
  ids?: string[];
}

export interface DeleteTracePayload {
  traceId: string;
}

// --- translate-selection.ts payloads ---
export interface TranslateSelectionPayload {
  sourceText: string;
  contextSentence?: string;
  mode?: 'default' | 'poetry' | 'webnovel' | 'paragraph' | 'word-only';
}

export interface TranslateSelectionResult {
  translatedText: string;
  mode: string;
  model: string;
}

// --- settings.ts payloads ---
export interface GetSettingsResult {
  providers: ProviderEntity[];
  prompts: PromptTemplate[];
  preferences: Record<string, unknown>;
  runtime: {
    lastUsedProviderId?: string;
    lastUsedProviderName?: string;
    lastUsedModel?: string;
    lastUsedAt?: number;
    providerStatus: Record<string, { lastSuccessAt?: number; lastErrorAt?: number; lastError?: string; lastLatencyMs?: number }>;
  };
  smartHighlightEnabled: boolean;
  smartExpansionEnabled: boolean;
  autoTraceEnabled: boolean;
  autoTracePoolSize: number;
  wordTranslationMode: number;
  wordTranslationStyle: string;
  paragraphTranslationEnabled: boolean;
  paragraphTranslationStyle: string;
  translationFontSizeEm: number;
  translationUnderlineStyle: string;
  translationDotSizePx: number;
  translationTextColor: string;
}

export interface UpdateSettingsPayload {
  provider?: Partial<ProviderEntity> & { providerId: string };
  prompt?: Partial<PromptTemplate> & { templateId: string };
  preference?: { key: string; value: unknown };
  preferences?: Record<string, unknown>;
  smartHighlightEnabled?: boolean;
  smartExpansionEnabled?: boolean;
  autoTraceEnabled?: boolean;
  autoTracePoolSize?: number;
}

// --- Weekly highlights ---
export interface GetWeeklyHighlightsPayload {
  limit?: number;
}

export interface GetWeeklyHighlightsResult {
  items: Array<{
    lemma: string;
    vocabId?: string;
    source: 'environment' | 'wordbank';
    totalCount: number;
    rank?: number;
    mastered?: boolean;
  }>;
}

// --- Cleanup ---
export interface CleanupOldEncountersPayload {
  cleanupAgeDays?: number;
  cleanupMinCount?: number;
  dryRun?: boolean;
}

export interface CleanupOldEncountersResult {
  deletedEncounters: number;
  deletedLemmaStats: number;
  deletedVocabulary: number;
  cutoff: number;
}

// --- Giant Wordbank (Encounters Explorer) ---
export interface GetGiantWordbankPayload {
  limit?: number;
  offset?: number;
  sortBy?: 'frequency' | 'recency';
  sortOrder?: 'asc' | 'desc';
  filter?: 'all' | 'traced' | 'known' | 'learning';
  search?: string;
}

export interface GiantWordbankItem {
  lemmaStatId: string;
  lemma: string;
  normalizedLemma: string;
  totalCount: number;
  pageCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  inWordbank: boolean;
  dictRank?: number;
  vocabId?: string;
  isTraced?: boolean;
  isKnown?: boolean;
  familiarityScore?: number;
}

export interface GetGiantWordbankResult {
  items: GiantWordbankItem[];
  total: number;
}

// --- Timeline Card (Context-based Review) ---
export interface DrawTimelineCardPayload {
  count?: number;
  excludeIds?: string[];
  tracedOnly?: boolean;
}

export interface TimelineEncounter {
  encounterId: string;
  pageTitle?: string;
  pageUrl: string;
  contextSentence?: string;
  source: string;
  createdAt: number;
}

export interface TimelineCard {
  vocabId: string;
  lemma: string;
  surface: string;
  meaning: string;
  weightedScore: number;
  isTraced: boolean;
  encounters: TimelineEncounter[];
}

export interface DrawTimelineCardResult {
  cards: TimelineCard[];
}

// --- dev-debug.ts payloads ---
export type DevDebugAction = 'getStats' | 'clearVocabulary' | 'clearEncounters' | 'clearTraces' | 'resetScores' | 'clearAll' | 'reinitNoiseWords' | 'exportData' | 'resetConfig';

export interface DevDebugPayload {
  action: DevDebugAction;
}
