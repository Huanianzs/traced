import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { sendMessageFromPopup } from '../lib/messaging';
import { t, getLocale, setLocale, localeNames, Locale } from '../lib/i18n';
import { isDark, onThemeChange, getProficiencyDotColor } from '../lib/theme';
import { D3WordCloud } from './components/dashboard/D3WordCloud';
import { ProficiencyRing } from '../components/ProficiencyRing';
import '../styles/index.css';

interface VocabItem {
  vocabId: string;
  lemma: string;
  surface: string;
  language: string;
  meaning: string;
  proficiency: 0 | 1 | 2 | 3 | 4 | 5;
  encounterCount: number;
  weightedScore?: number;
  lastEncounterAt?: number;
  createdAt: number;
  sourceWordbankId?: string;
  scoreLocked?: boolean;
  isKnown?: boolean;
}

interface Encounter {
  encounterId: string;
  vocabId: string;
  surface: string;
  pageUrl: string;
  pageHost: string;
  pageTitle?: string;
  contextSentence?: string;
  source: 'trace' | 'scan' | 'lookup' | 'manual' | 'import' | 'wordbank' | 'rate_known' | 'rate_familiar' | 'rate_unknown';
  createdAt: number;
}

interface WordbankDTO {
  wordbankId: string;
  code: string;
  name: string;
  description?: string;
  language: string;
  builtIn: boolean;
  wordCount: number;
  enabled: boolean;
}

interface WordbankStatsItem {
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

interface WordbankWordDTO {
  wordId: string;
  lemma: string;
  surface: string;
  rank?: number;
  vocabId?: string;
  proficiency?: 0 | 1 | 2 | 3 | 4 | 5;
  encounterCount?: number;
  lastSeenAt?: number;
}

interface ApiProvider {
  providerId: string;
  name: string;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  available?: boolean;
  priority?: number;
  deletedAt?: number;
  updatedAt?: number;
}

interface SettingsResponse {
  providers: ApiProvider[];
  preferences: Record<string, unknown>;
  runtime?: {
    lastUsedProviderId?: string;
    lastUsedProviderName?: string;
    lastUsedModel?: string;
    lastUsedAt?: number;
    providerStatus?: Record<string, { lastSuccessAt?: number; lastErrorAt?: number; lastError?: string; lastLatencyMs?: number }>;
  };
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function Options() {
  const [locale, setLocaleState] = useState<Locale>(getLocale());
  const [dark, setDark] = useState(isDark);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'review' | 'library' | 'settings' | 'about' | 'dev'>('dashboard');
  const [activeSubTab, setActiveSubTab] = useState<'list' | 'encounters' | 'manage' | 'stats'>('list');
  const [vocabList, setVocabList] = useState<VocabItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [vocabFilter, setVocabFilter] = useState<'all' | 'noise' | 'normal' | 'traced'>('all');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingVocab, setLoadingVocab] = useState(false);
  const [expandedVocab, setExpandedVocab] = useState<string | null>(null);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [loadingEncounters, setLoadingEncounters] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newWordbankName, setNewWordbankName] = useState('');
  const [newWordbankDesc, setNewWordbankDesc] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [importWordbankId, setImportWordbankId] = useState('');
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [newWord, setNewWord] = useState('');
  const [newMeaning, setNewMeaning] = useState('');

  // Wordbank state
  const [wordbanks, setWordbanks] = useState<WordbankDTO[]>([]);
  const [wordbankStats, setWordbankStats] = useState<WordbankStatsItem[]>([]);
  const [statsSummary, setStatsSummary] = useState({ totalVocabulary: 0, totalMastered: 0, overallMasteryRate: 0 });
  const [loadingWordbanks, setLoadingWordbanks] = useState(false);
  // Word detail state
  const [selectedWordbank, setSelectedWordbank] = useState<WordbankStatsItem | null>(null);
  const [wordbankWords, setWordbankWords] = useState<WordbankWordDTO[]>([]);
  const [wordsFilter, setWordsFilter] = useState<'all' | 'encountered' | 'not_encountered' | 'mastered' | 'learning'>('all');
  const [wordsTotal, setWordsTotal] = useState(0);
  const [loadingWords, setLoadingWords] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [providerName, setProviderName] = useState('');
  const [editingProviderId, setEditingProviderId] = useState<string>('default');
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [runtimeStatus, setRuntimeStatus] = useState<SettingsResponse['runtime'] | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [poetryEnabled, setPoetryEnabled] = useState(true);
  const [webnovelEnabled, setWebnovelEnabled] = useState(true);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [wordTranslationMode, setWordTranslationMode] = useState(1);
  const [wordTranslationStyle, setWordTranslationStyle] = useState<'above' | 'left'>('above');
  const [paragraphTranslationEnabled, setParagraphTranslationEnabled] = useState(false);
  const [paragraphTranslationStyle, setParagraphTranslationStyle] = useState<'sentence' | 'block'>('block');
  const [noiseWordbankId, setNoiseWordbankId] = useState('');
  const [noiseConfigMode, setNoiseConfigMode] = useState(false);
  const [viewWordsMode, setViewWordsMode] = useState(false);
  const [translationFontSizeEm, setTranslationFontSizeEm] = useState(0.65);
  const [translationUnderlineStyle, setTranslationUnderlineStyle] = useState('dotted');
  const [translationDotSizePx, setTranslationDotSizePx] = useState(4);
  const [translationTextColor, setTranslationTextColor] = useState('#666666');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; text: string }>({ type: 'idle', text: '' });
  const [showLangMenu, setShowLangMenu] = useState(false);

  // Dev debug state
  const [dbStats, setDbStats] = useState<Record<string, number> | null>(null);
  const [devLoading, setDevLoading] = useState<string | null>(null);
  const [devResult, setDevResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [debugMode, setDebugMode] = useState(false);

  // Dashboard state
  const [weeklyHighlights, setWeeklyHighlights] = useState<Array<{ lemma: string; vocabId?: string; source: 'environment' | 'wordbank'; totalCount: number; rank?: number; mastered?: boolean }>>([]);
  const [autoTraceEnabled, setAutoTraceEnabled] = useState(true);
  const [autoTracePoolSize, setAutoTracePoolSize] = useState(30);
  const [smartExpansionEnabled, setSmartExpansionEnabled] = useState(true);
  const [envWordCount, setEnvWordCount] = useState(0);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [cloudDetailWord, setCloudDetailWord] = useState<{ lemma: string; source: string; totalCount: number; meaning?: string; encounters: Encounter[] } | null>(null);
  const [loadingCloudDetail, setLoadingCloudDetail] = useState(false);
  const [insightDismissed, setInsightDismissed] = useState(false);
  const [insightMeaning, setInsightMeaning] = useState('');

  // Encounters Explorer state
  const [giantWordbank, setGiantWordbank] = useState<Array<{ lemmaStatId: string; lemma: string; normalizedLemma: string; totalCount: number; pageCount: number; firstSeenAt: number; lastSeenAt: number; inWordbank: boolean; dictRank?: number; vocabId?: string; isTraced?: boolean; isKnown?: boolean; familiarityScore?: number }>>([]);
  const [giantTotal, setGiantTotal] = useState(0);
  const [giantPage, setGiantPage] = useState(0);
  const [giantSort, setGiantSort] = useState<'frequency' | 'recency'>('frequency');
  const [giantFilter, setGiantFilter] = useState<'all' | 'traced' | 'known' | 'learning'>('all');
  const [giantSearch, setGiantSearch] = useState('');
  const [loadingGiant, setLoadingGiant] = useState(false);

  // Timeline review state
  const [timelineCards, setTimelineCards] = useState<Array<{ vocabId: string; lemma: string; surface: string; meaning: string; weightedScore: number; isTraced: boolean; encounters: Array<{ encounterId: string; pageTitle?: string; pageUrl: string; contextSentence?: string; source: string; createdAt: number }> }>>([]);
  const [timelineActive, setTimelineActive] = useState(false);
  const [timelineIndex, setTimelineIndex] = useState(0);
  const [timelineStage, setTimelineStage] = useState<0 | 1 | 2>(0);

  // Review tab state
  const [reviewWords, setReviewWords] = useState<Array<{ vocabId: string; lemma: string; surface: string; weightedScore: number; meaning: string; sourceTraceId?: string; pageHost?: string; createdAt: number }>>([]);
  const [reviewEncounters, setReviewEncounters] = useState<Map<string, Encounter[]>>(new Map());
  const [reviewExpanded, setReviewExpanded] = useState<string | null>(null);
  const [loadingReview, setLoadingReview] = useState(false);
  const [reviewTranslations, setReviewTranslations] = useState<Map<string, string>>(new Map());

  const devAction = async (action: string, label: string) => {
    if (action !== 'getStats' && action !== 'exportData' && !confirm(t('common.confirmAction', locale).replace('{label}', label))) return;
    setDevLoading(action);
    setDevResult(null);
    try {
      const result = await sendMessageFromPopup<unknown, Record<string, unknown>>('DEV_DEBUG', { action });
      if (action === 'getStats') {
        setDbStats(result as unknown as Record<string, number>);
      } else if (action === 'exportData') {
        const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `traced-export-${Date.now()}.json`; a.click();
        URL.revokeObjectURL(url);
        setDevResult({ type: 'success', text: '数据已导出' });
      } else {
        setDevResult({ type: 'success', text: `${label} 完成` });
        // Refresh stats
        const stats = await sendMessageFromPopup<unknown, Record<string, number>>('DEV_DEBUG', { action: 'getStats' });
        setDbStats(stats);
      }
    } catch (err) {
      setDevResult({ type: 'error', text: err instanceof Error ? err.message : '操作失败' });
    } finally {
      setDevLoading(null);
    }
  };

  useEffect(() => {
    if (activeTab === 'dev' && !dbStats) devAction('getStats', '');
  }, [activeTab]);

  const loadDashboard = async () => {
    setLoadingDashboard(true);
    try {
      const result = await sendMessageFromPopup<unknown, { items: Array<{ lemma: string; vocabId?: string; source: 'environment' | 'wordbank'; totalCount: number; rank?: number; mastered?: boolean }> }>('GET_WEEKLY_HIGHLIGHTS', { limit: 150 });
      setWeeklyHighlights(result.items || []);
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    } finally {
      setLoadingDashboard(false);
    }
  };

  const handleCloudWordClick = async (item: { lemma: string; source: string; totalCount: number }) => {
    setCloudDetailWord({ ...item, meaning: '', encounters: [] });
    setLoadingCloudDetail(true);
    try {
      const checkResult = await sendMessageFromPopup<unknown, { exists: boolean; vocab?: { vocabId: string; meaning?: string } }>('CHECK_VOCAB', { word: item.lemma });
      if (checkResult?.exists && checkResult.vocab?.vocabId) {
        const [encResult, trResult] = await Promise.all([
          sendMessageFromPopup<unknown, { encounters: Encounter[] }>('GET_WORD_ENCOUNTERS', { vocabId: checkResult.vocab.vocabId, limit: 5 }),
          checkResult.vocab.meaning ? Promise.resolve(null) : sendMessageFromPopup<unknown, { translations: Record<string, { meaning: string }> }>('BATCH_TRANSLATE_WORDS', { words: [{ lemma: item.lemma, vocabId: checkResult.vocab.vocabId }], mode: 'smart' }),
        ]);
        const meaning = checkResult.vocab.meaning || trResult?.translations?.[item.lemma]?.meaning || '';
        setCloudDetailWord(prev => prev ? { ...prev, meaning, encounters: encResult.encounters || [] } : null);
      } else {
        // Word not in vocab yet, try to translate
        const trResult = await sendMessageFromPopup<unknown, { translations: Record<string, { meaning: string }> }>('BATCH_TRANSLATE_WORDS', { words: [{ lemma: item.lemma }], mode: 'smart' });
        const meaning = trResult?.translations?.[item.lemma]?.meaning || '';
        setCloudDetailWord(prev => prev ? { ...prev, meaning } : null);
      }
    } catch {} finally {
      setLoadingCloudDetail(false);
    }
  };

  const loadGiantWordbank = async (overrides: { page?: number; sort?: string; filter?: string; search?: string } = {}) => {
    setLoadingGiant(true);
    const targetPage = overrides.page ?? giantPage;
    const targetSort = (overrides.sort ?? giantSort) as 'frequency' | 'recency';
    const targetFilter = (overrides.filter ?? giantFilter) as 'all' | 'traced' | 'known' | 'learning';
    const targetSearch = overrides.search ?? giantSearch;
    try {
      const result = await sendMessageFromPopup<unknown, { items: typeof giantWordbank; total: number }>('GET_GIANT_WORDBANK', {
        limit: 50, offset: targetPage * 50, sortBy: targetSort, sortOrder: 'desc', filter: targetFilter, search: targetSearch || undefined,
      });
      setGiantWordbank(result.items || []);
      setGiantTotal(result.total || 0);
    } catch (err) {
      console.error('Failed to load giant wordbank:', err);
    } finally {
      setLoadingGiant(false);
    }
  };

  const handleDrawTimeline = async () => {
    try {
      const result = await sendMessageFromPopup<unknown, { cards: typeof timelineCards }>('DRAW_TIMELINE_CARD', { count: 5, tracedOnly: true });
      if (result.cards?.length) {
        setTimelineCards(result.cards);
        setTimelineIndex(0);
        setTimelineStage(0);
        setTimelineActive(true);
      }
    } catch (err) {
      console.error('Failed to draw timeline cards:', err);
    }
  };

  const handleTimelineRate = async (rating: 'known' | 'familiar' | 'unknown') => {
    const card = timelineCards[timelineIndex];
    if (!card) return;
    try {
      await sendMessageFromPopup('RATE_WORD', { vocabId: card.vocabId, rating });
    } catch {}
    if (timelineIndex + 1 < timelineCards.length) {
      setTimelineIndex(timelineIndex + 1);
      setTimelineStage(0);
    } else {
      setTimelineActive(false);
    }
  };

  const loadReviewWords = async () => {
    setLoadingReview(true);
    try {
      const result = await sendMessageFromPopup<unknown, { words: typeof reviewWords }>('GET_TRACED_WORDS', {});
      setReviewWords(result.words || []);
      // Batch translate words missing meanings
      const needTr = (result.words || []).filter(w => !w.meaning);
      if (needTr.length > 0) {
        sendMessageFromPopup<unknown, { translations: Record<string, { meaning: string }> }>('BATCH_TRANSLATE_WORDS', {
          words: needTr.map(w => ({ lemma: w.lemma, vocabId: w.vocabId })), mode: 'smart',
        }).then(tr => {
          const map = new Map<string, string>();
          for (const [k, v] of Object.entries(tr.translations)) {
            if (v.meaning) map.set(k, v.meaning);
          }
          setReviewTranslations(map);
        }).catch(() => {});
      }
    } catch (err) {
      console.error('Failed to load review words:', err);
    } finally {
      setLoadingReview(false);
    }
  };

  const loadReviewEncounters = async (vocabId: string) => {
    if (reviewEncounters.has(vocabId)) return;
    try {
      const result = await sendMessageFromPopup<unknown, { encounters: Encounter[]; total: number }>('GET_WORD_ENCOUNTERS', { vocabId, limit: 20 });
      setReviewEncounters(prev => new Map(prev).set(vocabId, result.encounters || []));
    } catch {}
  };

  useEffect(() => {
    if (activeTab === 'dashboard') loadDashboard();
    if (activeTab === 'review') loadReviewWords();
  }, [activeTab]);

  useEffect(() => {
    loadSettings();
    loadWordbanks();
    const unsubTheme = onThemeChange(setDark);
    // Refresh when page becomes visible
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadSettings(activeTab === 'settings');
        if (activeTab === 'dashboard') { loadDashboard(); loadWordbanks(); }
        if (activeTab === 'library' && activeSubTab === 'encounters') { setGiantPage(0); loadGiantWordbank({ page: 0 }); }
        if (activeTab === 'library' && activeSubTab === 'list') loadVocab(true);
        if (activeTab === 'library' && activeSubTab === 'manage') loadWordbanks();
        if (activeTab === 'library' && activeSubTab === 'stats') loadWordbankStats();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      unsubTheme();
    };
  }, [activeTab, activeSubTab]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowAddModal(false);
        setShowCreateModal(false);
        setShowImportModal(false);
        setTimelineActive(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (activeTab !== 'settings') return;
    const timer = window.setInterval(() => {
      loadSettings(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [activeTab]);

  const handleLocaleChange = (newLocale: Locale) => {
    setLocale(newLocale);
    setLocaleState(newLocale);
    setShowLangMenu(false);
  };

  const loadSettings = async (preserveEditor = false) => {
    try {
      const data = await sendMessageFromPopup<unknown, SettingsResponse>('GET_SETTINGS', {});
      setProviders(data.providers);
      setRuntimeStatus(data.runtime ?? null);
      if (!preserveEditor) {
        const provider = data.providers.find(p => p.enabled) || data.providers[0];
        if (provider) {
          setEditingProviderId(provider.providerId);
          setProviderName(provider.name || '');
          setApiKey(provider.apiKey);
          setBaseUrl(provider.baseUrl);
          setModel(provider.defaultModel);
          try {
            const { models: modelList, suggestedModel } = await fetchModels(provider.baseUrl, provider.apiKey);
            if (modelList.length > 0) setModels(modelList);
            if (!provider.defaultModel?.trim() && suggestedModel) setModel(suggestedModel);
          } catch {
            setModels([]);
          }
        } else {
          setEditingProviderId(crypto.randomUUID());
          setProviderName('');
          setApiKey('');
          setBaseUrl('');
          setModel('');
          setModels([]);
        }
      }
      if (data.preferences) {
        if (typeof data.preferences.poetryEnabled === 'boolean') setPoetryEnabled(data.preferences.poetryEnabled);
        if (typeof data.preferences.webnovelEnabled === 'boolean') setWebnovelEnabled(data.preferences.webnovelEnabled);
        if (typeof data.preferences.webSearchEnabled === 'boolean') setWebSearchEnabled(data.preferences.webSearchEnabled);
        if (typeof data.preferences.wordTranslationMode === 'number') setWordTranslationMode(data.preferences.wordTranslationMode as number);
        if (data.preferences.wordTranslationStyle === 'left' || data.preferences.wordTranslationStyle === 'above') {
          setWordTranslationStyle(data.preferences.wordTranslationStyle);
        }
        if (typeof data.preferences.paragraphTranslationEnabled === 'boolean') setParagraphTranslationEnabled(data.preferences.paragraphTranslationEnabled);
        if (data.preferences.paragraphTranslationStyle === 'sentence' || data.preferences.paragraphTranslationStyle === 'block') {
          setParagraphTranslationStyle(data.preferences.paragraphTranslationStyle);
        }
        if (typeof data.preferences.noiseWordbankId === 'string') setNoiseWordbankId(data.preferences.noiseWordbankId as string);
        if (typeof data.preferences.translationFontSizeEm === 'number') setTranslationFontSizeEm(data.preferences.translationFontSizeEm as number);
        if (typeof data.preferences.translationUnderlineStyle === 'string') setTranslationUnderlineStyle(data.preferences.translationUnderlineStyle as string);
        if (typeof data.preferences.translationDotSizePx === 'number') setTranslationDotSizePx(data.preferences.translationDotSizePx as number);
        if (typeof data.preferences.translationTextColor === 'string') setTranslationTextColor(data.preferences.translationTextColor as string);
        if (typeof data.preferences.debugMode === 'boolean') setDebugMode(data.preferences.debugMode);
        if (typeof data.preferences.autoTraceEnabled === 'boolean') setAutoTraceEnabled(data.preferences.autoTraceEnabled as boolean);
        if (typeof data.preferences.autoTracePoolSize === 'number') setAutoTracePoolSize(data.preferences.autoTracePoolSize as number);
        if (typeof data.preferences.smartExpansionEnabled === 'boolean') setSmartExpansionEnabled(data.preferences.smartExpansionEnabled as boolean);
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  };

  const handleSelectProvider = (provider: ApiProvider) => {
    setEditingProviderId(provider.providerId);
    setProviderName(provider.name || '');
    setApiKey(provider.apiKey || '');
    setBaseUrl(provider.baseUrl || '');
    setModel(provider.defaultModel || '');
    setModels([]);
    setShowModelDropdown(false);
  };

  const handleNewProvider = () => {
    setEditingProviderId(crypto.randomUUID());
    setProviderName('');
    setApiKey('');
    setBaseUrl('');
    setModel('');
    setModels([]);
    setShowModelDropdown(false);
  };

  const visibleProviders = providers
    .filter((p) => !p.deletedAt)
    .sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER));

  const toggleProviderAvailable = async (provider: ApiProvider, available: boolean) => {
    await sendMessageFromPopup('UPDATE_SETTINGS', {
      provider: { providerId: provider.providerId, available }
    });
    await loadSettings(true);
  };

  const deleteProvider = async (provider: ApiProvider) => {
    await sendMessageFromPopup('UPDATE_SETTINGS', {
      provider: { providerId: provider.providerId, deletedAt: Date.now(), enabled: false }
    });
    await loadSettings(false);
  };

  const moveProvider = async (providerId: string, direction: -1 | 1) => {
    const list = visibleProviders;
    const idx = list.findIndex((p) => p.providerId === providerId);
    const target = idx + direction;
    if (idx < 0 || target < 0 || target >= list.length) return;
    const a = list[idx];
    const b = list[target];
    const pa = a.priority ?? idx + 1;
    const pb = b.priority ?? target + 1;
    await Promise.all([
      sendMessageFromPopup('UPDATE_SETTINGS', { provider: { providerId: a.providerId, priority: pb } }),
      sendMessageFromPopup('UPDATE_SETTINGS', { provider: { providerId: b.providerId, priority: pa } }),
    ]);
    await loadSettings(true);
  };

  useEffect(() => {
    if (activeTab === 'library' && activeSubTab === 'list') {
      loadVocab(true);
    } else if (activeTab === 'library' && activeSubTab === 'manage') {
      loadWordbanks();
    } else if (activeTab === 'library' && activeSubTab === 'stats') {
      loadWordbankStats();
    } else if (activeTab === 'settings') {
      loadWordbanks();
    }
  }, [activeTab, activeSubTab, searchQuery, vocabFilter]);

  const loadWordbanks = async () => {
    setLoadingWordbanks(true);
    try {
      const result = await sendMessageFromPopup<unknown, { items: WordbankDTO[]; envWordCount: number }>('LIST_WORDBANKS', {});
      setWordbanks(result.items);
      setEnvWordCount(result.envWordCount ?? 0);
    } catch (err) {
      console.error('Failed to load wordbanks:', err);
    } finally {
      setLoadingWordbanks(false);
    }
  };

  const loadWordbankStats = async () => {
    try {
      const result = await sendMessageFromPopup<unknown, { items: WordbankStatsItem[]; summary: typeof statsSummary }>('GET_WORDBANK_STATS', {});
      setWordbankStats(result.items);
      setStatsSummary(result.summary);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  const loadWordbankWords = async (wordbankId: string, filter: typeof wordsFilter = 'all', append = false) => {
    setLoadingWords(true);
    try {
      const offset = append ? wordbankWords.length : 0;
      const result = await sendMessageFromPopup<unknown, { items: WordbankWordDTO[]; total: number; filteredTotal: number }>(
        'GET_WORDBANK_WORDS',
        { wordbankId, limit: 100, offset, filter, sortBy: 'rank', sortOrder: 'asc' }
      );
      setWordbankWords(prev => append ? [...prev, ...result.items] : result.items);
      setWordsTotal(result.filteredTotal);
    } catch (err) {
      console.error('Failed to load wordbank words:', err);
    } finally {
      setLoadingWords(false);
    }
  };

  const handleSelectWordbank = async (stat: WordbankStatsItem) => {
    setSelectedWordbank(stat);
    setWordsFilter('all');
    await loadWordbankWords(stat.wordbankId, 'all');
  };

  const handleFilterChange = async (filter: typeof wordsFilter) => {
    setWordsFilter(filter);
    if (selectedWordbank) {
      await loadWordbankWords(selectedWordbank.wordbankId, filter);
    }
  };

  const handleViewWordbankWords = async (wb: WordbankDTO) => {
    const stat = wordbankStats.find(s => s.wordbankId === wb.wordbankId);
    const target: WordbankStatsItem = stat || {
      wordbankId: wb.wordbankId, code: wb.code, name: wb.name,
      total: wb.wordCount, encountered: 0, mastered: 0, learning: 0, newCount: 0, masteryRate: 0,
    };
    setActiveSubTab('stats');
    await handleSelectWordbank(target);
  };

  const toggleWordbank = async (wordbankId: string, enabled: boolean) => {
    try {
      await sendMessageFromPopup('UPSERT_USER_WORDBANKS', {
        selections: [{ wordbankId, enabled }]
      });
      setWordbanks(prev => prev.map(wb =>
        wb.wordbankId === wordbankId ? { ...wb, enabled } : wb
      ));
    } catch (err) {
      console.error('Failed to toggle wordbank:', err);
    }
  };

  const setNoiseWordbankFromManage = async (wordbankId: string, enabled: boolean) => {
    try {
      const nextNoiseId = enabled ? wordbankId : '';
      await sendMessageFromPopup('UPDATE_SETTINGS', {
        preferences: {
          noiseWordbankId: nextNoiseId,
          noiseManualAdd: [],
          noiseManualRemove: [],
        },
      });
      setNoiseWordbankId(nextNoiseId);
      setStatus({ type: 'success', text: enabled ? '已设置噪声词库' : '已取消噪声词库' });
    } catch (err) {
      setStatus({ type: 'error', text: err instanceof Error ? err.message : '设置噪声词库失败' });
    }
  };

  const loadVocab = async (reset = false) => {
    if (loadingVocab) return;
    setLoadingVocab(true);
    try {
      const currentPage = reset ? 0 : page;
      const result = await sendMessageFromPopup<unknown, { items: VocabItem[]; total: number }>(
        'GET_VOCAB_LIST',
        { limit: 20, offset: currentPage * 20, search: searchQuery, vocabFilter }
      );

      setVocabList(prev => reset ? result.items : [...prev, ...result.items]);
      setHasMore(result.items.length === 20);
      setPage(currentPage + 1);
    } catch (err) {
      console.error('Failed to load vocab:', err);
    } finally {
      setLoadingVocab(false);
    }
  };

  const loadEncounters = async (vocabId: string) => {
    setLoadingEncounters(true);
    try {
      const result = await sendMessageFromPopup<unknown, { encounters: Encounter[]; total: number }>(
        'GET_WORD_ENCOUNTERS',
        { vocabId, limit: 10 }
      );
      setEncounters(result.encounters);
    } catch (err) {
      console.error('Failed to load encounters:', err);
    } finally {
      setLoadingEncounters(false);
    }
  };

  const handleExpandVocab = async (vocabId: string) => {
    if (expandedVocab === vocabId) {
      setExpandedVocab(null);
      setEncounters([]);
    } else {
      setExpandedVocab(vocabId);
      await loadEncounters(vocabId);
    }
  };

  const handleDeleteVocab = async (vocabId: string) => {
    if (!confirm(t('settings.words.confirmDelete', locale))) return;
    try {
      await sendMessageFromPopup('DELETE_VOCAB', { vocabId });
      setVocabList(prev => prev.filter(v => v.vocabId !== vocabId));
      if (expandedVocab === vocabId) {
        setExpandedVocab(null);
        setEncounters([]);
      }
      // Notify active tab to remove highlights for this word
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'REMOVE_PAGE_VOCAB', vocabId }).catch(() => {});
      }
    } catch (err) {
      console.error('Failed to delete vocab:', err);
    }
  };

  const handleUnlockWord = async (vocabId: string) => {
    try {
      await sendMessageFromPopup('UNLOCK_NOISE_WORD', { vocabId });
      setVocabList(prev => prev.map(v => v.vocabId === vocabId ? { ...v, scoreLocked: false, weightedScore: 0, isKnown: false, familiarityScore: 0 } : v));
    } catch (err) {
      console.error('Failed to unlock word:', err);
    }
  };

  const handleCreateWordbank = async () => {
    if (!newWordbankName.trim()) return;
    try {
      await sendMessageFromPopup('CREATE_WORDBANK', {
        name: newWordbankName.trim(),
        description: newWordbankDesc.trim() || undefined,
        language: 'en'
      });
      setShowCreateModal(false);
      setNewWordbankName('');
      setNewWordbankDesc('');
      loadWordbanks();
    } catch (err) {
      console.error('Failed to create wordbank:', err);
      setStatus({ type: 'error', text: err instanceof Error ? err.message : 'Failed to create wordbank' });
    }
  };

  const handleDeleteWordbank = async (wordbankId: string, name: string) => {
    if (!confirm(t('common.deleteWordbank', locale).replace('{name}', name))) return;
    try {
      await sendMessageFromPopup('DELETE_WORDBANK', { wordbankId });
      loadWordbanks();
    } catch (err) {
      console.error('Failed to delete wordbank:', err);
      setStatus({ type: 'error', text: err instanceof Error ? err.message : 'Failed to delete wordbank' });
    }
  };

  const handleImportWords = async () => {
    if (!importText.trim() || !importWordbankId) return;
    setImporting(true);
    try {
      const words = importText.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(word => ({ lemma: word, surface: word }));

      const result = await sendMessageFromPopup<unknown, { imported: number }>('IMPORT_WORDBANK_WORDS', {
        wordbankId: importWordbankId,
        words
      });

      setStatus({ type: 'success', text: t('common.importedWords', locale).replace('{count}', String(result.imported)) });
      setShowImportModal(false);
      setImportText('');
      setImportWordbankId('');
      loadWordbanks();
    } catch (err) {
      console.error('Failed to import words:', err);
      setStatus({ type: 'error', text: err instanceof Error ? err.message : 'Failed to import words' });
    } finally {
      setImporting(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const input = e.target;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImportText(typeof ev.target?.result === 'string' ? ev.target.result : '');
      input.value = '';
    };
    reader.onerror = () => setStatus({ type: 'error', text: t('common.failedReadFile', locale) });
    reader.readAsText(file);
  };

  const handleAddWord = async () => {
    if (!newWord.trim()) return;
    try {
      const result = await sendMessageFromPopup<unknown, VocabItem>('UPSERT_VOCAB', {
        lemma: newWord.trim(),
        surface: newWord.trim(),
        meaning: newMeaning.trim(),
        language: 'en'
      });
      setVocabList(prev => [{ ...result, encounterCount: 0 }, ...prev]);
      setShowAddModal(false);
      setNewWord('');
      setNewMeaning('');
    } catch (err) {
      console.error('Failed to add word:', err);
    }
  };

  const openPageWithHighlight = (url: string, textQuote?: string) => {
    const targetUrl = textQuote
      ? `${url}#:~:text=${encodeURIComponent(textQuote)}`
      : url;
    window.open(targetUrl, '_blank');
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return t('common.today', locale);
    if (days === 1) return t('common.yesterday', locale);
    if (days < 7) return `${days} ${t('common.daysAgo', locale)}`;
    return date.toLocaleDateString();
  };

  const getProficiencyLabel = (level: number) => {
    const keys = ['proficiency.new', 'proficiency.learning', 'proficiency.familiar', 'proficiency.known', 'proficiency.mastered', 'proficiency.expert'];
    return t(keys[level] || 'proficiency.new', locale);
  };

  const detectApiType = (url: string): string => {
    const u = url.toLowerCase();
    if (u.includes('openai.com')) return 'OpenAI';
    if (u.includes('longcat.chat')) return 'Longcat';
    if (u.includes('deepseek')) return 'DeepSeek';
    if (u.includes('dashscope.aliyuncs') || u.includes('qwen')) return 'Qwen';
    if (u.includes('groq.com')) return 'Groq';
    if (u.includes('localhost') || u.includes('127.0.0.1')) return 'Ollama';
    if (u.includes('anthropic')) return 'Claude';
    if (u.includes('moonshot')) return 'Moonshot';
    if (u.includes('zhipu') || u.includes('bigmodel')) return 'GLM';
    return 'OpenAI Compatible';
  };

  const fetchModels = async (url: string, key: string): Promise<{ models: string[]; type: string; suggestedModel?: string }> => {
    const normalizedUrl = url.replace(/\/+$/, '');
    const apiType = detectApiType(url);

    let parsed: URL;
    try {
      parsed = new URL(normalizedUrl);
    } catch {
      throw new Error('Invalid URL');
    }

    const baseFromInput = normalizedUrl.replace(/\/chat\/completions$/, '');
    const origin = parsed.origin;
    const baseCandidates = [...new Set([
      baseFromInput,
      `${origin}/openai/v1`,
      `${origin}/v1`,
      origin,
    ])];

    // Prefer official model listing: dropdown should only show returned models.
    for (const base of baseCandidates) {
      try {
        const response = await fetch(`${base}/models`, {
          headers: { 'Authorization': `Bearer ${key}` }
        });
        if (response.ok) {
          const data = await response.json();
          if (data.data && Array.isArray(data.data)) {
            const modelList = data.data
              .map((m: { id?: string }) => m?.id)
              .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
              .sort();
            return { models: modelList, type: apiType, suggestedModel: modelList[0] };
          }
        }
        if (response.status === 401) throw new Error('401');
      } catch (e) {
        if (e instanceof Error && e.message === '401') throw e;
      }
    }

    // Optional connectivity test when user has already provided a model.
    if (model.trim()) {
      for (const base of baseCandidates) {
        try {
          const response = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${key}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: model.trim(),
              messages: [{ role: 'user', content: 'hi' }],
              max_tokens: 1
            })
          });
          if (response.ok) {
            return { models: [], type: apiType, suggestedModel: model.trim() };
          }
          if (response.status === 401) throw new Error('401');
        } catch (e) {
          if (e instanceof Error && e.message === '401') throw e;
        }
      }
    }

    throw new Error('Connection failed');
  };

  const handleSaveApi = async (makeActive = true) => {
    if (!apiKey || !baseUrl) {
      setStatus({ type: 'error', text: t('settings.api.fillRequired', locale) });
      return;
    }

    setSaving(true);
    setStatus({ type: 'loading', text: t('settings.api.connecting', locale) });

    const apiType = providerName.trim() || detectApiType(baseUrl);

    try {
      const { models: modelList, type, suggestedModel } = await fetchModels(baseUrl, apiKey);
      const resolvedModel = model.trim() || suggestedModel || modelList[0] || '';
      if (modelList.length > 0) setModels(modelList);
      if (resolvedModel) setModel(resolvedModel);

      await sendMessageFromPopup('UPDATE_SETTINGS', {
        provider: {
          providerId: editingProviderId || crypto.randomUUID(),
          name: apiType,
          apiKey,
          baseUrl,
          defaultModel: resolvedModel,
          enabled: makeActive,
          available: true,
          priority: providers.find((p) => p.providerId === editingProviderId)?.priority
            ?? ((visibleProviders.length ? (visibleProviders[visibleProviders.length - 1].priority ?? 0) : 0) + 1),
        },
      });

      await loadSettings();
      setStatus({
        type: 'success',
        text: `${type} ${t('settings.api.connected', locale)}${makeActive ? '' : ' (backup saved)'}${modelList.length ? ` (${modelList.length} ${t('settings.api.modelsFound', locale)})` : ''}`
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';

      // Save user config even when connection test fails.
      await sendMessageFromPopup('UPDATE_SETTINGS', {
        provider: {
          providerId: editingProviderId || crypto.randomUUID(),
          name: apiType,
          apiKey,
          baseUrl,
          defaultModel: model.trim(),
          enabled: makeActive,
          available: true,
          priority: providers.find((p) => p.providerId === editingProviderId)?.priority
            ?? ((visibleProviders.length ? (visibleProviders[visibleProviders.length - 1].priority ?? 0) : 0) + 1),
        },
      });
      await loadSettings();

      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('invalid')) {
        setStatus({ type: 'error', text: `${t('settings.saved', locale)} ${t('settings.api.invalidKey', locale)}` });
      } else {
        setStatus({ type: 'error', text: `${t('settings.saved', locale)} ${t('settings.api.connectionFailed', locale)}` + (msg ? `: ${msg}` : '') });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSaveModes = async () => {
    setSaving(true);
    setStatus({ type: 'idle', text: '' });

    try {
      await sendMessageFromPopup('UPDATE_SETTINGS', {
        preferences: {
          poetryEnabled,
          webnovelEnabled,
          webSearchEnabled,
          wordTranslationMode,
          wordTranslationStyle,
          smartHighlightEnabled: wordTranslationMode !== 0,
          paragraphTranslationEnabled,
          paragraphTranslationStyle,
          translationFontSizeEm,
          translationUnderlineStyle,
          translationDotSizePx,
          translationTextColor,
        },
      });
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'UPDATE_SETTINGS',
          settings: {
            wordTranslationStyle,
            paragraphTranslationStyle,
            translationFontSizeEm,
            translationUnderlineStyle,
            translationDotSizePx,
            translationTextColor,
          },
        }).catch(() => {});
        chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_TRANSLATION', mode: wordTranslationMode }).catch(() => {});
        chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PARAGRAPH_TRANSLATION', visible: paragraphTranslationEnabled }).catch(() => {});
      }
      setStatus({ type: 'success', text: t('settings.saved', locale) });
    } catch (err) {
      setStatus({ type: 'error', text: err instanceof Error ? err.message : t('settings.saveFailed', locale) });
    } finally {
      setSaving(false);
    }
  };

  const previewUnderlineStyle = translationUnderlineStyle === 'none' ? 'none' : (translationUnderlineStyle || 'dotted');
  const previewDotSize = Math.max(0, Math.min(Number.isFinite(translationDotSizePx) ? translationDotSizePx : 4, 12));
  const previewFontSize = Math.max(0.3, Math.min(Number.isFinite(translationFontSizeEm) ? translationFontSizeEm : 0.65, 2));
  const previewTextColor = /^#[0-9a-fA-F]{6}$/.test(translationTextColor) ? translationTextColor : '#666666';
  const previewWord = 'trace';
  const previewWordMeaning = '追踪';
  const previewSentenceSource = 'This is the first sentence. This is the second sentence.';
  const previewSentenceTranslation = '这是第一句。 这是第二句。';

  return (
    <div className={`min-h-screen pb-20 ${dark ? 'bg-[#0a0a0a]' : 'bg-neutral-50'}`}>
      {/* Header */}
      <div className={`border-b ${dark ? 'bg-[#111] border-neutral-800' : 'bg-white border-neutral-200'}`}>
        <div className="max-w-5xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/icons/icon-128.png" alt="Traced" className={`w-12 h-12 rounded-xl ${dark ? 'bg-white p-1' : ''}`} />
              <div>
                <h1 className={`text-xl font-semibold ${dark ? 'text-neutral-100' : 'text-neutral-900'}`}>{t('settings.title', locale)}</h1>
                <p className={`text-sm ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{t('settings.subtitle', locale)}</p>
              </div>
            </div>
            {/* Language Switcher */}
            <div className="relative">
              <button
                onClick={() => setShowLangMenu(!showLangMenu)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${dark ? 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800' : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'}`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                {localeNames[locale]}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {showLangMenu && (
                <div className={`absolute right-0 mt-1 w-36 rounded-lg shadow-float py-1 z-10 ${dark ? 'bg-neutral-800 border border-neutral-700' : 'bg-white border border-neutral-200'}`}>
                  {(Object.keys(localeNames) as Locale[]).map((l) => (
                    <button
                      key={l}
                      onClick={() => handleLocaleChange(l)}
                      className={`w-full px-3 py-2 text-left text-sm ${dark ? 'hover:bg-neutral-700' : 'hover:bg-neutral-50'} ${
                        locale === l ? 'text-brand-seal font-medium' : dark ? 'text-neutral-300' : 'text-neutral-700'
                      }`}
                    >
                      {localeNames[l]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className={`border-b ${dark ? 'bg-[#111] border-neutral-800' : 'bg-white border-neutral-200'}`}>
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex gap-6">
            {(['dashboard', 'review', 'library', 'settings', 'about', 'dev'] as Array<'dashboard' | 'review' | 'library' | 'settings' | 'about' | 'dev'>).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'text-brand-seal border-brand-seal'
                    : dark ? 'text-neutral-500 border-transparent hover:text-neutral-300' : 'text-neutral-500 border-transparent hover:text-neutral-700'
                }`}
              >
                {t(`settings.tab.${tab}`, locale)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {status.type !== 'idle' && (
          <div className={`mb-6 p-3 rounded-lg text-sm flex items-center gap-2 ${
            status.type === 'loading'
              ? dark ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-50 text-blue-700'
              : status.type === 'success'
              ? dark ? 'bg-green-900/30 text-green-400' : 'bg-green-50 text-green-700'
              : dark ? 'bg-red-900/30 text-red-400' : 'bg-red-50 text-red-700'
          }`}>
            {status.type === 'loading' && (
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="32" strokeDashoffset="12" />
              </svg>
            )}
            {status.text}
          </div>
        )}

        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            {/* Section: My Targets */}
            <div>
              <h2 className={`text-lg font-medium mb-1 ${dark ? 'text-neutral-100' : 'text-neutral-900'}`}>What are you preparing for?</h2>
              <p className={`text-sm mb-4 ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>Select your target word libraries</p>
              <div className="flex flex-wrap gap-2">
                {wordbanks.filter(wb => wb.builtIn).map(wb => (
                  <button
                    key={wb.wordbankId}
                    onClick={async () => {
                      await sendMessageFromPopup('UPSERT_USER_WORDBANKS', {
                        selections: [{ wordbankId: wb.wordbankId, enabled: !wb.enabled }]
                      });
                      loadWordbanks();
                    }}
                    className={`px-4 py-2 text-sm rounded-full border transition-all ${
                      wb.enabled
                        ? 'bg-brand-seal text-white border-brand-seal'
                        : dark ? 'bg-neutral-900 text-neutral-400 border-neutral-700 hover:border-neutral-500' : 'bg-white text-neutral-600 border-neutral-300 hover:border-neutral-400'
                    }`}
                  >
                    {wb.name}
                    {wb.wordCount > 0 && <span className="ml-1.5 opacity-60">{wb.wordCount}</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* Section: Auto-trace Pool */}
            <div className={`p-5 rounded-xl border ${dark ? 'bg-neutral-900/50 border-neutral-800' : 'bg-neutral-50 border-neutral-200'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className={`text-sm font-medium ${dark ? 'text-neutral-200' : 'text-neutral-800'}`}>{t('settings.autoTrace', locale)}</h3>
                  <p className={`text-xs mt-0.5 ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                    {t('settings.autoTraceDesc', locale)}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    const next = !autoTraceEnabled;
                    setAutoTraceEnabled(next);
                    await sendMessageFromPopup('UPDATE_SETTINGS', { autoTraceEnabled: next });
                  }}
                  className={`relative w-11 h-6 rounded-full transition-colors ${autoTraceEnabled ? 'bg-brand-seal' : dark ? 'bg-neutral-700' : 'bg-neutral-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${autoTraceEnabled ? 'translate-x-5' : ''}`} />
                </button>
              </div>
              {autoTraceEnabled && (
                <div className="mt-3 flex items-center gap-3">
                  <label className={`text-xs ${dark ? 'text-neutral-400' : 'text-neutral-500'}`}>{t('settings.poolSize', locale)}</label>
                  <input
                    type="number"
                    min={5}
                    max={200}
                    value={autoTracePoolSize}
                    onChange={async (e) => {
                      const val = Math.max(5, Math.min(200, Number(e.target.value) || 30));
                      setAutoTracePoolSize(val);
                      await sendMessageFromPopup('UPDATE_SETTINGS', { autoTracePoolSize: val });
                    }}
                    className={`w-20 px-2 py-1 text-xs rounded border ${dark ? 'bg-neutral-800 border-neutral-700 text-neutral-200' : 'bg-white border-neutral-300 text-neutral-800'}`}
                  />
                </div>
              )}
            </div>

            {/* Section: Word Cloud / Weekly Highlights */}
            <div>
              <h2 className={`text-lg font-medium mb-1 ${dark ? 'text-neutral-100' : 'text-neutral-900'}`}>Your Footprint</h2>
              <p className={`text-sm mb-4 ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>Words you've encountered this week</p>
              {loadingDashboard ? (
                <div className="flex justify-center py-12">
                  <svg className="w-6 h-6 animate-spin text-brand-seal" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="32" strokeDashoffset="12" />
                  </svg>
                </div>
              ) : weeklyHighlights.length === 0 ? (
                <div className={`text-center py-12 rounded-xl border ${dark ? 'border-neutral-800' : 'border-neutral-200'}`}>
                  <p className={`${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>No words encountered yet. Start browsing to build your footprint.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Word Cloud — d3-cloud layout */}
                  <div className={`rounded-xl border relative overflow-hidden ${dark ? 'bg-[#0a0a0a] border-neutral-800' : 'bg-white border-neutral-200'}`}>
                    <D3WordCloud
                      data={weeklyHighlights.slice(0, 150).map(h => ({
                        text: h.lemma,
                        value: h.totalCount,
                        source: h.source,
                        mastered: h.mastered,
                      }))}
                      dark={dark}
                      onWordClick={handleCloudWordClick}
                    />
                  </div>

                  {/* Cloud Word Detail Popup */}
                  {cloudDetailWord && (
                    <div className={`p-4 rounded-xl border ${dark ? 'bg-[#111] border-neutral-800' : 'bg-white border-neutral-200'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`text-lg font-medium ${dark ? 'text-neutral-100' : 'text-neutral-900'}`}>{cloudDetailWord.lemma}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            cloudDetailWord.source === 'environment'
                              ? dark ? 'bg-amber-900/30 text-amber-400' : 'bg-amber-50 text-amber-600'
                              : dark ? 'bg-brand-seal/20 text-brand-seal' : 'bg-brand-seal/10 text-brand-seal'
                          }`}>{cloudDetailWord.source === 'environment' ? t('dashboard.environment', locale) : t('dashboard.wordbank', locale)}</span>
                        </div>
                        <button onClick={() => setCloudDetailWord(null)} className={`p-1 rounded ${dark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100'}`}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                        </button>
                      </div>
                      {cloudDetailWord.meaning && (
                        <p className={`text-sm mb-2 ${dark ? 'text-neutral-300' : 'text-neutral-600'}`}>{cloudDetailWord.meaning}</p>
                      )}
                      <p className={`text-xs mb-2 ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>{t('dashboard.seenTimes', locale).replace('{count}', String(cloudDetailWord.totalCount))}</p>
                      {loadingCloudDetail ? (
                        <div className={`text-xs ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>{t('dashboard.loading', locale)}</div>
                      ) : cloudDetailWord.encounters.length > 0 ? (
                        <div className="space-y-1.5">
                          {cloudDetailWord.encounters.map(enc => (
                            <div key={enc.encounterId} className={`text-xs px-2 py-1.5 rounded ${dark ? 'bg-neutral-800/60' : 'bg-neutral-50'}`}>
                              {enc.contextSentence && <p className={`${dark ? 'text-neutral-300' : 'text-neutral-600'}`}>"{enc.contextSentence}"</p>}
                              <p className={`${dark ? 'text-neutral-600' : 'text-neutral-400'} ${enc.contextSentence ? 'mt-0.5' : ''}`}>
                                {enc.pageTitle || enc.pageHost} · {new Date(enc.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className={`text-xs ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>{t('dashboard.noEncounters', locale)}</p>
                      )}
                    </div>
                  )}

                  {/* Insight Card — with translation + close button */}
                  {!insightDismissed && weeklyHighlights.filter(h => h.source === 'environment').length > 0 && (() => {
                    const topEnv = weeklyHighlights.filter(h => h.source === 'environment')[0];
                    // Fetch meaning for insight word on first render
                    if (!insightMeaning && topEnv) {
                      sendMessageFromPopup<unknown, { translations: Record<string, { meaning: string }> }>('BATCH_TRANSLATE_WORDS', {
                        words: [{ lemma: topEnv.lemma }], mode: 'smart',
                      }).then(tr => {
                        const m = tr?.translations?.[topEnv.lemma]?.meaning;
                        if (m) setInsightMeaning(m);
                      }).catch(() => {});
                    }
                    return (
                      <div className={`p-4 rounded-xl border relative ${dark ? 'bg-amber-900/10 border-amber-800/30' : 'bg-amber-50 border-amber-200'}`}>
                        <button
                          onClick={() => setInsightDismissed(true)}
                          className={`absolute top-2 right-2 p-1 rounded ${dark ? 'text-amber-600 hover:bg-amber-900/30' : 'text-amber-400 hover:bg-amber-100'}`}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                        </button>
                        <p className={`text-sm pr-6 ${dark ? 'text-amber-300' : 'text-amber-800'}`}>
                          {t('dashboard.insightText', locale).split('{word}')[0]}<strong>'{topEnv.lemma}'</strong>{t('dashboard.insightText', locale).split('{word}')[1]?.replace('{count}', String(topEnv.totalCount))}
                        </p>
                        {insightMeaning && (
                          <p className={`text-sm mt-1 ${dark ? 'text-amber-400/70' : 'text-amber-700'}`}>{insightMeaning}</p>
                        )}
                        <button
                          onClick={async () => {
                            try {
                              const vocab = await sendMessageFromPopup('UPSERT_VOCAB', { lemma: topEnv.lemma, surface: topEnv.lemma, language: 'en' }) as { vocabId: string };
                              if (vocab?.vocabId) {
                                await sendMessageFromPopup('TOGGLE_TRACE_WORD', { vocabId: vocab.vocabId, traced: true });
                              }
                              loadDashboard();
                            } catch {}
                          }}
                          className="mt-2 px-3 py-1.5 text-xs font-medium bg-brand-seal text-white rounded-lg hover:opacity-90 transition-opacity"
                        >
                          Trace
                        </button>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

          </div>
        )}

        {/* Review Tab */}
        {activeTab === 'review' && (
          <div className="space-y-6">
            {/* Header + Start Review */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className={`text-lg font-medium ${dark ? 'text-neutral-100' : 'text-neutral-900'}`}>{t('review.tracedWords', locale)}</h2>
                <p className={`text-sm mt-0.5 ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                  {reviewWords.length > 0 ? `${reviewWords.length} ${t('review.tracedWords', locale).toLowerCase()}` : ''}
                </p>
              </div>
              {reviewWords.length > 0 && (
                <button
                  onClick={handleDrawTimeline}
                  className="px-5 py-2.5 bg-brand-seal text-white text-sm font-medium rounded-full shadow-lg shadow-brand-seal/20 hover:shadow-brand-seal/30 hover:-translate-y-0.5 transition-all active:scale-95"
                >
                  {t('review.timelineReview', locale)}
                </button>
              )}
            </div>

            {/* Last session chips */}
            {timelineCards.length > 0 && !timelineActive && (
              <div className={`rounded-xl border p-4 ${dark ? 'bg-[#111] border-neutral-800' : 'bg-white border-neutral-200'}`}>
                <h3 className={`text-xs font-medium mb-2 ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>{t('review.lastSession', locale)}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {timelineCards.map(c => (
                    <span key={c.vocabId} className={`text-sm px-3 py-1 rounded-full ${dark ? 'bg-neutral-800 text-neutral-300' : 'bg-neutral-100 text-neutral-700'}`}>
                      {c.surface}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Traced word list */}
            {loadingReview ? (
              <div className="flex justify-center py-12">
                <div className={`w-6 h-6 border-2 rounded-full animate-spin ${dark ? 'border-neutral-700 border-t-brand-seal' : 'border-neutral-200 border-t-brand-seal'}`} />
              </div>
            ) : reviewWords.length === 0 ? (
              <div className="text-center py-16">
                <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${dark ? 'bg-neutral-800' : 'bg-neutral-100'}`}>
                  <svg className={`w-8 h-8 ${dark ? 'text-neutral-600' : 'text-neutral-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342" />
                  </svg>
                </div>
                <p className={`text-sm ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>{t('review.noTracedWords', locale)}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {reviewWords.map(w => {
                  const meaning = w.meaning || reviewTranslations.get(w.lemma) || '';
                  const isExpanded = reviewExpanded === w.vocabId;
                  const encs = reviewEncounters.get(w.vocabId);
                  // Sort encounters: trace & lookup first
                  const sortedEncs = encs ? [...encs].sort((a, b) => {
                    const priority = (s: string) => s === 'trace' ? 0 : s === 'lookup' ? 1 : 2;
                    return priority(a.source) - priority(b.source) || b.createdAt - a.createdAt;
                  }) : null;
                  return (
                    <div key={w.vocabId} className={`rounded-xl border transition-colors ${dark ? 'bg-[#111] border-neutral-800' : 'bg-white border-neutral-200'}`}>
                      {/* Card header */}
                      <button
                        className="w-full px-4 py-3 flex items-center gap-3 text-left"
                        onClick={() => {
                          const next = isExpanded ? null : w.vocabId;
                          setReviewExpanded(next);
                          if (next) loadReviewEncounters(w.vocabId);
                        }}
                      >
                        <span className={`w-2 h-2 rounded-full shrink-0 ${getProficiencyDotColor(w.weightedScore)}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`font-medium ${dark ? 'text-neutral-100' : 'text-neutral-900'}`}>{w.surface}</span>
                            <span className={`text-xs ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>{Math.round(w.weightedScore)}</span>
                          </div>
                          {meaning && (
                            <p className={`text-sm truncate ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>{meaning}</p>
                          )}
                        </div>
                        <svg className={`w-4 h-4 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''} ${dark ? 'text-neutral-600' : 'text-neutral-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {/* Expanded: encounter list */}
                      {isExpanded && (
                        <div className={`px-4 pb-4 border-t ${dark ? 'border-neutral-800' : 'border-neutral-100'}`}>
                          <p className={`text-xs font-medium mt-3 mb-2 ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>{t('review.encounters', locale)}</p>
                          {!sortedEncs ? (
                            <div className="flex justify-center py-3">
                              <div className={`w-4 h-4 border-2 rounded-full animate-spin ${dark ? 'border-neutral-700 border-t-brand-seal' : 'border-neutral-200 border-t-brand-seal'}`} />
                            </div>
                          ) : sortedEncs.length === 0 ? (
                            <p className={`text-xs py-2 ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>{t('review.noEncounters', locale)}</p>
                          ) : (
                            <div className="space-y-1.5">
                              {sortedEncs.map(e => {
                                const sourceKey = `review.source.${e.source}` as const;
                                const sourceLabel = t(sourceKey, locale) !== sourceKey ? t(sourceKey, locale) : e.source;
                                const isHighlight = e.source === 'trace' || e.source === 'lookup';
                                return (
                                  <div key={e.encounterId} className={`text-xs px-3 py-2 rounded-lg ${
                                    isHighlight
                                      ? dark ? 'bg-brand-seal/10 border border-brand-seal/20' : 'bg-brand-seal/5 border border-brand-seal/10'
                                      : dark ? 'bg-neutral-800/60' : 'bg-neutral-50'
                                  }`}>
                                    <div className="flex items-center gap-2 mb-0.5">
                                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                        isHighlight
                                          ? 'bg-brand-seal/20 text-brand-seal'
                                          : dark ? 'bg-neutral-700 text-neutral-400' : 'bg-neutral-200 text-neutral-500'
                                      }`}>{sourceLabel}</span>
                                      <span className={dark ? 'text-neutral-600' : 'text-neutral-400'}>
                                        {new Date(e.createdAt).toLocaleDateString()} {new Date(e.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                      </span>
                                    </div>
                                    {e.contextSentence && (
                                      <p className={`mt-1 leading-relaxed ${dark ? 'text-neutral-300' : 'text-neutral-600'}`}>"{e.contextSentence}"</p>
                                    )}
                                    {e.pageTitle && (
                                      <p className={`mt-0.5 ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>{e.pageTitle}</p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Timeline Review Modal */}
        {timelineActive && timelineCards.length > 0 && (() => {
          const card = timelineCards[timelineIndex];
          if (!card) return null;
          const enc = card.encounters[0];
          return (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setTimelineActive(false)} role="dialog" aria-modal="true">
              <div className="w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
                <div className="flex flex-col items-center gap-4">
                  <div className={`text-sm ${dark ? 'text-neutral-400' : 'text-neutral-300'}`}>
                    {timelineIndex + 1} / {timelineCards.length}
                  </div>
                  <div className={`w-full rounded-2xl p-6 border-2 shadow-xl ${dark ? 'bg-[#111] border-neutral-700' : 'bg-white border-neutral-200'}`}>
                    {/* Stage 0: Context with blanked word */}
                    {timelineStage === 0 && enc?.contextSentence && (
                      <div className="text-center space-y-4">
                        <p className={`text-xs ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>{enc.pageTitle || ''}</p>
                        <p className={`text-base leading-relaxed ${dark ? 'text-neutral-200' : 'text-neutral-700'}`}>
                          "{enc.contextSentence.replace(new RegExp(escapeRegExp(card.surface), 'gi'), '______')}"
                        </p>
                        <button
                          onClick={() => setTimelineStage(1)}
                          className="mt-2 px-4 py-2 text-sm bg-brand-seal text-white rounded-full hover:opacity-90 transition-opacity"
                        >
                          {t('review.reveal', locale)}
                        </button>
                      </div>
                    )}
                    {/* Stage 0 fallback: no context */}
                    {timelineStage === 0 && !enc?.contextSentence && (
                      <div className="text-center space-y-4">
                        <span className={`font-serif text-3xl font-medium ${dark ? 'text-neutral-100' : 'text-neutral-900'}`}>{card.surface}</span>
                        <button
                          onClick={() => setTimelineStage(2)}
                          className="mt-2 px-4 py-2 text-sm bg-brand-seal text-white rounded-full hover:opacity-90 transition-opacity"
                        >
                          {t('review.showMeaning', locale)}
                        </button>
                      </div>
                    )}
                    {/* Stage 1: Reveal word in context */}
                    {timelineStage === 1 && (
                      <div className="text-center space-y-4">
                        <p className={`text-xs ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>{enc?.pageTitle || ''}</p>
                        <p className={`text-base leading-relaxed ${dark ? 'text-neutral-200' : 'text-neutral-700'}`}>
                          "{enc?.contextSentence || ''}"
                        </p>
                        <span className={`inline-block font-serif text-2xl font-medium text-brand-seal`}>{card.surface}</span>
                        <button
                          onClick={() => setTimelineStage(2)}
                          className="mt-2 px-4 py-2 text-sm bg-brand-seal text-white rounded-full hover:opacity-90 transition-opacity"
                        >
                          {t('review.showMeaning', locale)}
                        </button>
                      </div>
                    )}
                    {/* Stage 2: Full reveal + encounter timeline + rating */}
                    {timelineStage === 2 && (
                      <div className="space-y-4">
                        <div className="text-center">
                          <span className={`font-serif text-2xl font-medium ${dark ? 'text-neutral-100' : 'text-neutral-900'}`}>{card.surface}</span>
                          <p className={`text-sm mt-1 ${dark ? 'text-neutral-400' : 'text-neutral-600'}`}>{card.meaning || '—'}</p>
                        </div>
                        {/* Encounter timeline */}
                        <div className={`space-y-2 max-h-40 overflow-y-auto ${dark ? 'text-neutral-400' : 'text-neutral-500'}`}>
                          {card.encounters.slice(0, 5).map(e => (
                            <div key={e.encounterId} className={`text-xs px-3 py-2 rounded-lg ${
                              e.source === 'trace' || e.source === 'lookup'
                                ? dark ? 'bg-brand-seal/10 border border-brand-seal/20' : 'bg-brand-seal/5 border border-brand-seal/10'
                                : dark ? 'bg-neutral-800/60' : 'bg-neutral-50'
                            }`}>
                              {e.contextSentence && <p className={`${dark ? 'text-neutral-300' : 'text-neutral-600'}`}>"{e.contextSentence}"</p>}
                              <p className={`${e.contextSentence ? 'mt-0.5' : ''} ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>
                                {e.pageTitle || (() => { try { return new URL(e.pageUrl).hostname; } catch { return e.pageUrl; } })()} · {new Date(e.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                          ))}
                        </div>
                        {/* Rating buttons */}
                        <div className="flex gap-3 justify-center pt-2">
                          <button onClick={() => handleTimelineRate('known')}
                            className="px-5 py-2.5 text-sm font-medium rounded-full bg-green-500 text-white hover:bg-green-600 transition-colors">
                            {t('popup.rateKnown', locale)}
                          </button>
                          <button onClick={() => handleTimelineRate('familiar')}
                            className="px-5 py-2.5 text-sm font-medium rounded-full bg-amber-500 text-white hover:bg-amber-600 transition-colors">
                            {t('popup.rateFamiliar', locale)}
                          </button>
                          <button onClick={() => handleTimelineRate('unknown')}
                            className="px-5 py-2.5 text-sm font-medium rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors">
                            {t('popup.rateUnknown', locale)}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}


        {activeTab === 'library' && (
          <div className="space-y-6">
            {/* Sub Tabs */}
            <div className={`flex p-1 space-x-1 rounded-xl ${dark ? 'bg-neutral-900' : 'bg-neutral-100'}`}>
              {(['list', 'encounters', 'manage', 'stats'] as const).map((sub) => (
                <button
                  key={sub}
                  onClick={() => { setActiveSubTab(sub); if (sub === 'encounters') { setGiantPage(0); loadGiantWordbank({ page: 0 }); } }}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                    activeSubTab === sub
                      ? dark ? 'bg-neutral-800 text-white shadow-sm' : 'bg-white text-neutral-900 shadow-sm'
                      : dark ? 'text-neutral-400 hover:text-neutral-200' : 'text-neutral-500 hover:text-neutral-700'
                  }`}
                >
                  {sub === 'list' && t('settings.library.list', locale)}
                  {sub === 'encounters' && t('settings.tab.encounters', locale)}
                  {sub === 'manage' && t('settings.library.manage', locale)}
                  {sub === 'stats' && t('settings.library.stats', locale)}
                </button>
              ))}
            </div>

            {activeSubTab === 'list' && (
          <div className={`space-y-6`}>
            {/* Header with Add Button */}
            <div className="flex items-center justify-between">
              <div className="relative flex-1 mr-4">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(0);
                  }}
                  placeholder={t('settings.words.search', locale)}
                  className={`w-full px-4 py-3 pl-10 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-seal/20 focus:border-brand-seal ${dark ? 'bg-[#111] border border-neutral-800 text-neutral-100' : 'bg-white border border-neutral-200 text-neutral-900'}`}
                />
                <svg className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${dark ? 'text-neutral-500' : 'text-neutral-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <button
                onClick={() => setShowAddModal(true)}
                className="px-4 py-3 bg-brand-seal text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                {t('settings.words.add', locale)}
              </button>
            </div>

            {/* Filter Chips */}
            <div className="flex items-center gap-2">
              {(['all', 'normal', 'noise', 'traced'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => { setVocabFilter(f); setPage(0); }}
                  className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                    vocabFilter === f
                      ? 'bg-brand-seal text-white'
                      : dark ? 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                  }`}
                >
                  {t(`vocab.filter.${f}`, locale)}
                </button>
              ))}
            </div>

            {/* Grid */}
            {vocabList.length === 0 && !loadingVocab ? (
              <div className="text-center py-12">
                <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${dark ? 'bg-neutral-800' : 'bg-neutral-200'}`}>
                  <svg className={`w-8 h-8 ${dark ? 'text-neutral-500' : 'text-neutral-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </div>
                <p className={`${dark ? 'text-neutral-400' : 'text-neutral-500'}`}>{t('settings.words.noWords', locale)}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {vocabList.map((vocab) => (
                  <div key={vocab.vocabId} className={`rounded-lg border transition-all ${dark ? 'bg-[#111] border-neutral-800' : 'bg-white border-neutral-200'}`}>
                    {/* Card Header */}
                    <div
                      className={`p-4 cursor-pointer hover:bg-opacity-50 ${dark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-50'}`}
                      onClick={() => handleExpandVocab(vocab.vocabId)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <ProficiencyRing level={vocab.proficiency} size="sm" />
                          <h3 className={`font-serif text-lg font-medium ${dark ? 'text-neutral-100' : 'text-neutral-900'}`}>{vocab.surface}</h3>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${dark ? 'bg-neutral-800 text-neutral-400' : 'bg-neutral-100 text-neutral-500'}`}>
                            {getProficiencyLabel(vocab.proficiency)}
                          </span>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className={`text-xs ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                            {vocab.encounterCount} {t('settings.words.encounters', locale)}
                          </div>
                          {vocab.scoreLocked ? (
                            <div className="text-xs font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                              100{t('settings.words.score', locale)}
                            </div>
                          ) : vocab.weightedScore !== undefined && vocab.weightedScore > 0 ? (
                            <div className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                              vocab.weightedScore >= 100
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                : vocab.weightedScore >= 30
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                : dark ? 'bg-neutral-800 text-neutral-400' : 'bg-neutral-100 text-neutral-500'
                            }`}>
                              {Math.round(vocab.weightedScore)}{t('settings.words.score', locale)}
                            </div>
                          ) : null}
                          <svg className={`w-5 h-5 transition-transform ${expandedVocab === vocab.vocabId ? 'rotate-180' : ''} ${dark ? 'text-neutral-500' : 'text-neutral-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                      {vocab.meaning && (
                        <p className={`text-sm mt-2 ${dark ? 'text-neutral-400' : 'text-neutral-600'}`}>{vocab.meaning}</p>
                      )}
                    </div>

                    {/* Expanded Content - Encounter History */}
                    {expandedVocab === vocab.vocabId && (
                      <div className={`border-t ${dark ? 'border-neutral-800' : 'border-neutral-100'}`}>
                        <div className="p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className={`text-sm font-medium ${dark ? 'text-neutral-300' : 'text-neutral-700'}`}>{t('settings.words.encounterHistory', locale)}</h4>
                            <div className="flex items-center gap-2">
                              {vocab.scoreLocked && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleUnlockWord(vocab.vocabId); }}
                                  className={`text-xs px-2 py-1 rounded transition-colors ${dark ? 'hover:bg-blue-900/20 text-blue-400' : 'hover:bg-blue-50 text-blue-500'}`}
                                >
                                  {t('vocab.unlock', locale)}
                                </button>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteVocab(vocab.vocabId); }}
                                className={`text-xs px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-colors`}
                              >
                                {t('settings.words.delete', locale)}
                              </button>
                            </div>
                          </div>

                          {loadingEncounters ? (
                            <div className="flex justify-center py-4">
                              <div className={`w-5 h-5 border-2 rounded-full animate-spin ${dark ? 'border-neutral-700 border-t-brand-seal' : 'border-neutral-200 border-t-brand-seal'}`} />
                            </div>
                          ) : encounters.length === 0 ? (
                            <p className={`text-sm text-center py-4 ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>{t('settings.words.noEncounters', locale)}</p>
                          ) : (
                            <div className="space-y-2">
                              {encounters.map((enc) => (
                                <div
                                  key={enc.encounterId}
                                  className={`p-3 rounded-lg ${dark ? 'bg-neutral-900' : 'bg-neutral-50'}`}
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                        enc.source === 'trace' ? 'bg-brand-seal' :
                                        enc.source === 'lookup' ? 'bg-amber-500' : 'bg-neutral-400'
                                      }`} />
                                      <span className={`text-xs ${dark ? 'text-neutral-400' : 'text-neutral-500'}`}>
                                        {enc.pageTitle || enc.pageHost}
                                      </span>
                                      {enc.source === 'trace' && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-seal/10 text-brand-seal">{t('settings.words.traced', locale)}</span>
                                      )}
                                      {enc.source === 'lookup' && (
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${dark ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-600'}`}>{t('settings.words.looked', locale)}</span>
                                      )}
                                    </div>
                                    <span className={`text-xs ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                                      {formatDate(enc.createdAt)}
                                    </span>
                                  </div>
                                  {enc.contextSentence && (
                                    <p className={`text-sm italic ml-3.5 ${dark ? 'text-neutral-300' : 'text-neutral-600'}`}>
                                      "{enc.contextSentence}"
                                    </p>
                                  )}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); openPageWithHighlight(enc.pageUrl, enc.contextSentence); }}
                                    className="mt-2 ml-3.5 text-xs text-brand-seal hover:underline"
                                  >
                                    {t('settings.words.jumpToPage', locale)}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Load More */}
            {hasMore && vocabList.length > 0 && (
              <div className="text-center pt-4">
                <button
                  onClick={() => loadVocab(false)}
                  disabled={loadingVocab}
                  className={`px-6 py-2 text-sm font-medium rounded-full transition-colors ${dark ? 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700' : 'bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50'}`}
                >
                  {loadingVocab ? '...' : t('settings.words.loadMore', locale)}
                </button>
              </div>
            )}

            {/* Add Word Modal */}
            {showAddModal && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAddModal(false)}>
                <div className={`w-full max-w-md mx-4 rounded-xl p-6 ${dark ? 'bg-[#111]' : 'bg-white'}`} onClick={e => e.stopPropagation()}>
                  <h3 className={`text-lg font-semibold mb-4 ${dark ? 'text-neutral-100' : 'text-neutral-900'}`}>{t('settings.words.addTitle', locale)}</h3>
                  <div className="space-y-4">
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${dark ? 'text-neutral-300' : 'text-neutral-700'}`}>{t('settings.words.word', locale)}</label>
                      <input
                        type="text"
                        value={newWord}
                        onChange={(e) => setNewWord(e.target.value)}
                        className={`w-full px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-seal/20 ${dark ? 'bg-neutral-900 border border-neutral-700 text-neutral-100' : 'border border-neutral-200'}`}
                        placeholder={t('settings.words.wordPlaceholder', locale)}
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${dark ? 'text-neutral-300' : 'text-neutral-700'}`}>{t('settings.words.meaning', locale)}</label>
                      <input
                        type="text"
                        value={newMeaning}
                        onChange={(e) => setNewMeaning(e.target.value)}
                        className={`w-full px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-seal/20 ${dark ? 'bg-neutral-900 border border-neutral-700 text-neutral-100' : 'border border-neutral-200'}`}
                        placeholder={t('settings.words.meaningPlaceholder', locale)}
                      />
                    </div>
                    <div className="flex gap-3 pt-2">
                      <button
                        onClick={() => setShowAddModal(false)}
                        className={`flex-1 py-2 text-sm font-medium rounded-lg ${dark ? 'bg-neutral-800 text-neutral-300' : 'bg-neutral-100 text-neutral-700'}`}
                      >
                        {t('common.cancel', locale)}
                      </button>
                      <button
                        onClick={handleAddWord}
                        disabled={!newWord.trim()}
                        className="flex-1 py-2 bg-brand-seal text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50"
                      >
                        {t('common.add', locale)}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
            )}

            {activeSubTab === 'encounters' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <p className={`text-sm ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>{t('encounters.desc', locale)}</p>
              <span className={`text-sm ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>{giantTotal} {t('encounters.words', locale)}</span>
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              <input
                type="text"
                placeholder={t('common.search', locale)}
                value={giantSearch}
                onChange={(e) => setGiantSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadGiantWordbank({ page: 0 })}
                className={`flex-1 min-w-[200px] px-3 py-2 text-sm rounded-lg border ${dark ? 'bg-neutral-900 border-neutral-700 text-neutral-200 placeholder:text-neutral-600' : 'bg-white border-neutral-300 text-neutral-800 placeholder:text-neutral-400'}`}
              />
              <select
                value={giantSort}
                onChange={(e) => { const val = e.target.value as 'frequency' | 'recency'; setGiantSort(val); setGiantPage(0); loadGiantWordbank({ sort: val, page: 0 }); }}
                className={`px-3 py-2 text-sm rounded-lg border ${dark ? 'bg-neutral-900 border-neutral-700 text-neutral-200' : 'bg-white border-neutral-300 text-neutral-800'}`}
              >
                <option value="frequency">{t('encounters.sortFreq', locale)}</option>
                <option value="recency">{t('encounters.sortRecent', locale)}</option>
              </select>
              <select
                value={giantFilter}
                onChange={(e) => { const val = e.target.value as typeof giantFilter; setGiantFilter(val); setGiantPage(0); loadGiantWordbank({ filter: val, page: 0 }); }}
                className={`px-3 py-2 text-sm rounded-lg border ${dark ? 'bg-neutral-900 border-neutral-700 text-neutral-200' : 'bg-white border-neutral-300 text-neutral-800'}`}
              >
                <option value="all">{t('encounters.filterAll', locale)}</option>
                <option value="traced">{t('encounters.filterTraced', locale)}</option>
                <option value="learning">{t('encounters.filterLearning', locale)}</option>
                <option value="known">{t('encounters.filterKnown', locale)}</option>
              </select>
            </div>
            {loadingGiant ? (
              <div className="flex justify-center py-12">
                <svg className="w-6 h-6 animate-spin text-brand-seal" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="32" strokeDashoffset="12" />
                </svg>
              </div>
            ) : giantWordbank.length === 0 ? (
              <div className={`text-center py-12 rounded-xl border ${dark ? 'border-neutral-800' : 'border-neutral-200'}`}>
                <p className={`${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>{t('encounters.empty', locale)}</p>
              </div>
            ) : (
              <div className="space-y-1">
                {giantWordbank.map(item => (
                  <div key={item.lemmaStatId} className={`flex items-center justify-between px-4 py-3 rounded-lg ${dark ? 'hover:bg-neutral-900' : 'hover:bg-neutral-50'}`}>
                    <div className="flex items-center gap-3">
                      <span className={`font-medium ${dark ? 'text-neutral-100' : 'text-neutral-900'}`}>{item.lemma}</span>
                      {item.isTraced && <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-seal/10 text-brand-seal">traced</span>}
                      {item.isKnown && <span className={`text-[10px] px-1.5 py-0.5 rounded ${dark ? 'bg-green-900/30 text-green-400' : 'bg-green-50 text-green-600'}`}>mastered</span>}
                      {item.inWordbank && <span className={`text-[10px] px-1.5 py-0.5 rounded ${dark ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-50 text-blue-600'}`}>wordbank</span>}
                    </div>
                    <div className={`flex items-center gap-4 text-xs ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                      <span>{item.totalCount}x</span>
                      <span>{item.pageCount} {t('encounters.pages', locale)}</span>
                      <span>{new Date(item.lastSeenAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {giantTotal > 50 && (
              <div className="flex justify-center gap-3 pt-4">
                <button
                  disabled={giantPage === 0}
                  onClick={() => { const p = giantPage - 1; setGiantPage(p); loadGiantWordbank({ page: p }); }}
                  className={`px-4 py-2 text-sm rounded-lg border disabled:opacity-30 ${dark ? 'border-neutral-700 text-neutral-300' : 'border-neutral-300 text-neutral-700'}`}
                >
                  {t('common.prev', locale)}
                </button>
                <span className={`px-4 py-2 text-sm ${dark ? 'text-neutral-400' : 'text-neutral-500'}`}>
                  {giantPage + 1} / {Math.ceil(giantTotal / 50)}
                </span>
                <button
                  disabled={(giantPage + 1) * 50 >= giantTotal}
                  onClick={() => { const p = giantPage + 1; setGiantPage(p); loadGiantWordbank({ page: p }); }}
                  className={`px-4 py-2 text-sm rounded-lg border disabled:opacity-30 ${dark ? 'border-neutral-700 text-neutral-300' : 'border-neutral-300 text-neutral-700'}`}
                >
                  {t('common.next', locale)}
                </button>
              </div>
            )}
          </div>
            )}

            {activeSubTab === 'manage' && (
              <div className="space-y-4">
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { setNoiseConfigMode(v => !v); setViewWordsMode(false); }}
                    className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                      noiseConfigMode
                        ? 'bg-amber-500 text-white'
                        : dark ? 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                    }`}
                  >
                    {t('settings.manage.noiseWords', locale)}
                  </button>
                  <button
                    onClick={() => { setViewWordsMode(v => !v); setNoiseConfigMode(false); }}
                    className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                      viewWordsMode
                        ? 'bg-brand-seal text-white'
                        : dark ? 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700' : 'bg-brand-seal/10 text-brand-seal hover:bg-brand-seal/20'
                    }`}
                  >
                    {t('settings.manage.viewWords', locale)}
                  </button>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="px-4 py-2 bg-brand-seal text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    {t('settings.manage.newWordbank', locale)}
                  </button>
                </div>

                {loadingWordbanks ? (
                  <div className="flex justify-center py-8">
                    <div className={`w-6 h-6 border-2 rounded-full animate-spin ${dark ? 'border-neutral-700 border-t-brand-seal' : 'border-neutral-200 border-t-brand-seal'}`} />
                  </div>
                ) : wordbanks.length === 0 ? (
                  <div className="text-center py-12">
                    <p className={dark ? 'text-neutral-400' : 'text-neutral-500'}>{t('settings.library.noWordbanks', locale)}</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Virtual Environment Words Card */}
                    <div
                      onClick={() => viewWordsMode && handleViewWordbankWords({
                        wordbankId: '__env__', code: 'environment', name: t('settings.manage.envWordbank', locale),
                        wordCount: envWordCount, enabled: smartExpansionEnabled, builtIn: true, language: 'en',
                      })}
                      className={`p-4 rounded-xl border-2 border-dashed transition-all ${
                        viewWordsMode ? 'cursor-pointer ring-1 ' + (dark ? 'ring-emerald-500/40 hover:ring-emerald-400' : 'ring-emerald-400/20 hover:ring-emerald-500/60') : ''
                      } ${
                        smartExpansionEnabled
                          ? dark ? 'bg-emerald-900/10 border-emerald-500/30' : 'bg-emerald-50/50 border-emerald-400/30'
                          : dark ? 'bg-[#111] border-neutral-800' : 'bg-white border-neutral-300'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${smartExpansionEnabled ? (dark ? 'bg-emerald-900/30 text-emerald-400' : 'bg-emerald-100 text-emerald-600') : (dark ? 'bg-neutral-800 text-neutral-300' : 'bg-neutral-100 text-neutral-600')}`}>
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                          </div>
                          <div>
                            <h3 className={`font-medium ${dark ? 'text-neutral-200' : 'text-neutral-900'}`}>{t('settings.manage.envWordbank', locale)}</h3>
                            <p className={`text-xs ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{envWordCount} {t('settings.library.words', locale)}</p>
                          </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={smartExpansionEnabled}
                            onChange={async (e) => {
                              const enabled = e.target.checked;
                              await sendMessageFromPopup('UPDATE_SETTINGS', { smartExpansionEnabled: enabled });
                              setSmartExpansionEnabled(enabled);
                            }}
                            className="sr-only peer"
                          />
                          <div className={`w-11 h-6 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all ${
                            smartExpansionEnabled
                              ? 'bg-emerald-500'
                              : dark ? 'bg-neutral-700' : 'bg-neutral-300'
                          }`}></div>
                        </label>
                      </div>
                      <p className={`text-xs ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{t('settings.manage.envDesc', locale)}</p>
                    </div>
                    {wordbanks.map((wb) => (
                      <div
                        key={wb.wordbankId}
                        onClick={() => viewWordsMode && handleViewWordbankWords(wb)}
                        className={`p-4 rounded-xl border transition-all ${
                          viewWordsMode ? 'cursor-pointer ring-1 ' + (dark ? 'ring-brand-seal/40 hover:ring-brand-seal' : 'ring-brand-seal/20 hover:ring-brand-seal/60') : ''
                        } ${
                          wb.enabled
                            ? dark ? 'bg-brand-seal/10 border-brand-seal/30' : 'bg-brand-seal/5 border-brand-seal/20'
                            : dark ? 'bg-[#111] border-neutral-800' : 'bg-white border-neutral-200'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${dark ? 'bg-neutral-800 text-neutral-300' : 'bg-neutral-100 text-neutral-600'}`}>
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                              </svg>
                            </div>
                            <div>
                              <h3 className={`font-medium ${dark ? 'text-neutral-200' : 'text-neutral-900'}`}>{wb.name}</h3>
                              <p className={`text-xs ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{wb.wordCount} {t('settings.library.words', locale)}</p>
                            </div>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer" onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={noiseConfigMode ? noiseWordbankId === wb.wordbankId : wb.enabled}
                              onChange={(e) => noiseConfigMode
                                ? setNoiseWordbankFromManage(wb.wordbankId, e.target.checked)
                                : toggleWordbank(wb.wordbankId, e.target.checked)}
                              className="sr-only peer"
                            />
                            <div className={`w-11 h-6 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all ${
                              (noiseConfigMode ? noiseWordbankId === wb.wordbankId : wb.enabled)
                                ? (noiseConfigMode ? 'bg-amber-500' : 'bg-brand-seal')
                                : dark ? 'bg-neutral-700' : 'bg-neutral-300'
                            }`}></div>
                          </label>
                        </div>
                        {wb.description && (
                          <p className={`text-xs mb-2 ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{wb.description}</p>
                        )}
                        {!wb.builtIn && (
                          <div className={`flex gap-2 mt-3 pt-3 border-t border-dashed ${dark ? 'border-neutral-800' : 'border-neutral-200'}`} onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => { setImportWordbankId(wb.wordbankId); setShowImportModal(true); }}
                              className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${dark ? 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}
                            >
                              {t('settings.manage.import', locale)}
                            </button>
                            <button
                              onClick={() => handleDeleteWordbank(wb.wordbankId, wb.name)}
                              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${dark ? 'bg-red-900/20 text-red-400 hover:bg-red-900/40' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}
                            >
                              {t('settings.manage.delete', locale)}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Create Wordbank Modal */}
                {showCreateModal && (
                  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setShowCreateModal(false); setNewWordbankName(''); setNewWordbankDesc(''); }}>
                    <div className={`w-full max-w-md mx-4 rounded-xl p-6 ${dark ? 'bg-[#111]' : 'bg-white'}`} onClick={e => e.stopPropagation()}>
                      <h3 className={`text-lg font-semibold mb-4 ${dark ? 'text-neutral-100' : 'text-neutral-900'}`}>{t('settings.manage.createTitle', locale)}</h3>
                      <div className="space-y-4">
                        <div>
                          <label className={`block text-sm font-medium mb-1 ${dark ? 'text-neutral-300' : 'text-neutral-700'}`}>{t('settings.manage.name', locale)}</label>
                          <input
                            type="text"
                            value={newWordbankName}
                            onChange={(e) => setNewWordbankName(e.target.value)}
                            className={`w-full px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-seal/20 ${dark ? 'bg-neutral-900 border border-neutral-700 text-neutral-100' : 'border border-neutral-200'}`}
                            placeholder={t('settings.manage.namePlaceholder', locale)}
                            autoFocus
                          />
                        </div>
                        <div>
                          <label className={`block text-sm font-medium mb-1 ${dark ? 'text-neutral-300' : 'text-neutral-700'}`}>{t('settings.manage.descLabel', locale)}</label>
                          <input
                            type="text"
                            value={newWordbankDesc}
                            onChange={(e) => setNewWordbankDesc(e.target.value)}
                            className={`w-full px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-seal/20 ${dark ? 'bg-neutral-900 border border-neutral-700 text-neutral-100' : 'border border-neutral-200'}`}
                            placeholder={t('settings.manage.descPlaceholder', locale)}
                          />
                        </div>
                        <div className="flex gap-3 pt-2">
                          <button onClick={() => setShowCreateModal(false)} className={`flex-1 py-2 text-sm font-medium rounded-lg ${dark ? 'bg-neutral-800 text-neutral-300' : 'bg-neutral-100 text-neutral-700'}`}>{t('common.cancel', locale)}</button>
                          <button onClick={handleCreateWordbank} disabled={!newWordbankName.trim()} className="flex-1 py-2 bg-brand-seal text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50">{t('common.create', locale)}</button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Import Modal */}
                {showImportModal && (
                  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setShowImportModal(false); setImportText(''); setImportWordbankId(''); }}>
                    <div className={`w-full max-w-md mx-4 rounded-xl p-6 ${dark ? 'bg-[#111]' : 'bg-white'}`} onClick={e => e.stopPropagation()}>
                      <h3 className={`text-lg font-semibold mb-4 ${dark ? 'text-neutral-100' : 'text-neutral-900'}`}>{t('settings.manage.importTitle', locale)}</h3>
                      <div className="space-y-4">
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <label className={`block text-sm font-medium ${dark ? 'text-neutral-300' : 'text-neutral-700'}`}>{t('settings.manage.wordsPerLine', locale)}</label>
                            <label className="text-xs text-brand-seal cursor-pointer hover:underline">
                              {t('settings.manage.uploadTxt', locale)}
                              <input type="file" accept=".txt" onChange={handleFileUpload} className="hidden" />
                            </label>
                          </div>
                          <textarea
                            value={importText}
                            onChange={(e) => setImportText(e.target.value)}
                            className={`w-full h-32 px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-seal/20 resize-none ${dark ? 'bg-neutral-900 border border-neutral-700 text-neutral-100' : 'border border-neutral-200'}`}
                            placeholder={"apple\nbanana\ncherry"}
                          />
                          <p className={`text-xs mt-1 ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                            {importText ? `${importText.split('\n').filter(l => l.trim()).length} ${t('settings.manage.wordsDetected', locale)}` : t('settings.manage.pasteHint', locale)}
                          </p>
                        </div>
                        <div className="flex gap-3 pt-2">
                          <button onClick={() => setShowImportModal(false)} className={`flex-1 py-2 text-sm font-medium rounded-lg ${dark ? 'bg-neutral-800 text-neutral-300' : 'bg-neutral-100 text-neutral-700'}`}>{t('common.cancel', locale)}</button>
                          <button onClick={handleImportWords} disabled={!importText.trim() || importing} className="flex-1 py-2 bg-brand-seal text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50">{importing ? t('settings.manage.importing', locale) : t('settings.manage.import', locale)}</button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeSubTab === 'stats' && (
              <div className="space-y-6">
                {/* Stats Overview - donut + metrics */}
                <div className={`p-6 rounded-xl border flex flex-col md:flex-row items-center gap-8 ${dark ? 'bg-[#111] border-neutral-800' : 'bg-white border-neutral-200'}`}>
                  <div className="relative flex-shrink-0">
                    <svg className="w-32 h-32 transform -rotate-90">
                      <circle cx="64" cy="64" r="56" fill="none" stroke="currentColor" strokeWidth="8"
                        className={dark ? 'text-neutral-800' : 'text-neutral-100'} />
                      <circle cx="64" cy="64" r="56" fill="none" stroke="currentColor" strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={2 * Math.PI * 56}
                        strokeDashoffset={2 * Math.PI * 56 * (1 - (statsSummary.overallMasteryRate || 0))}
                        className="text-brand-seal transition-all duration-1000 ease-out" />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className={`text-2xl font-bold font-serif ${dark ? 'text-neutral-100' : 'text-neutral-900'}`}>
                        {Math.round((statsSummary.overallMasteryRate || 0) * 100)}%
                      </span>
                      <span className={`text-xs ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{t('settings.library.masteryRate', locale)}</span>
                    </div>
                  </div>
                  <div className="flex-1 grid grid-cols-3 gap-8 w-full">
                    <div className="text-center md:text-left">
                      <div className={`text-3xl font-bold mb-1 font-serif ${dark ? 'text-neutral-100' : 'text-neutral-900'}`}>{statsSummary.totalVocabulary}</div>
                      <div className={`text-xs uppercase tracking-wider font-medium ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{t('settings.library.totalWords', locale)}</div>
                    </div>
                    <div className="text-center md:text-left">
                      <div className="text-3xl font-bold mb-1 font-serif text-green-500">{statsSummary.totalMastered}</div>
                      <div className={`text-xs uppercase tracking-wider font-medium ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{t('settings.library.mastered', locale)}</div>
                    </div>
                    <div className="text-center md:text-left">
                      <div className="text-3xl font-bold mb-1 font-serif text-amber-500">{statsSummary.totalVocabulary - statsSummary.totalMastered}</div>
                      <div className={`text-xs uppercase tracking-wider font-medium ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{t('settings.library.learning', locale)}</div>
                    </div>
                  </div>
                </div>

                {/* Word Detail View */}
                {selectedWordbank ? (
                  <div className={`rounded-xl border ${dark ? 'bg-[#111] border-neutral-800' : 'bg-white border-neutral-200'}`}>
                    <div className={`p-4 border-b flex items-center justify-between ${dark ? 'border-neutral-800' : 'border-neutral-100'}`}>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setSelectedWordbank(null)}
                          className={`p-1.5 rounded-lg transition-colors ${dark ? 'hover:bg-neutral-800 text-neutral-400' : 'hover:bg-neutral-100 text-neutral-500'}`}
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>
                        <div>
                          <h3 className={`font-medium ${dark ? 'text-neutral-200' : 'text-neutral-900'}`}>{selectedWordbank.wordbankId === '__env__' ? t('settings.manage.envWordbank', locale) : selectedWordbank.name}</h3>
                          <p className={`text-xs ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{wordsTotal} {t('settings.library.words', locale)}</p>
                        </div>
                      </div>
                      <select
                        value={wordsFilter}
                        onChange={(e) => handleFilterChange(e.target.value as typeof wordsFilter)}
                        className={`text-sm px-3 py-1.5 rounded-lg ${dark ? 'bg-neutral-800 border-neutral-700 text-neutral-300' : 'bg-neutral-50 border-neutral-200 text-neutral-700'} border`}
                      >
                        <option value="all">{t('settings.stats.filterAll', locale)}</option>
                        <option value="encountered">{t('settings.stats.filterEncountered', locale)}</option>
                        <option value="not_encountered">{t('settings.stats.filterNotEncountered', locale)}</option>
                        <option value="mastered">{t('settings.stats.filterMastered', locale)}</option>
                        <option value="learning">{t('settings.stats.filterLearning', locale)}</option>
                      </select>
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      {loadingWords ? (
                        <div className="flex justify-center py-8">
                          <div className={`w-6 h-6 border-2 rounded-full animate-spin ${dark ? 'border-neutral-700 border-t-brand-seal' : 'border-neutral-200 border-t-brand-seal'}`} />
                        </div>
                      ) : wordbankWords.length === 0 ? (
                        <div className="p-8 text-center">
                          <p className={dark ? 'text-neutral-500' : 'text-neutral-400'}>{t('settings.stats.noWords', locale)}</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                          {wordbankWords.map((word) => (
                            <div key={word.wordId} className={`px-4 py-3 flex items-center justify-between ${dark ? 'hover:bg-neutral-900' : 'hover:bg-neutral-50'}`}>
                              <div className="flex items-center gap-3">
                                <ProficiencyRing level={word.proficiency ?? 0} size="sm" />
                                <div>
                                  <span className={`font-medium ${dark ? 'text-neutral-200' : 'text-neutral-900'}`}>{word.lemma}</span>
                                  {word.surface !== word.lemma && (
                                    <span className={`ml-2 text-xs ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>({word.surface})</span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-4 text-xs">
                                {word.vocabId ? (
                                  <>
                                    <span className={dark ? 'text-neutral-400' : 'text-neutral-500'}>{word.encounterCount || 0} {t('settings.words.encounters', locale)}</span>
                                    <span className={`px-2 py-0.5 rounded-full ${
                                      (word.proficiency ?? 0) >= 4 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                      (word.proficiency ?? 0) >= 1 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                                      dark ? 'bg-neutral-800 text-neutral-400' : 'bg-neutral-100 text-neutral-500'
                                    }`}>
                                      {getProficiencyLabel(word.proficiency ?? 0)}
                                    </span>
                                  </>
                                ) : (
                                  <span className={`px-2 py-0.5 rounded-full ${dark ? 'bg-neutral-800 text-neutral-500' : 'bg-neutral-100 text-neutral-400'}`}>
                                    {t('settings.stats.notEncountered', locale)}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                          {wordbankWords.length < wordsTotal && (
                            <div className="p-4 text-center">
                              <button
                                onClick={() => selectedWordbank && loadWordbankWords(selectedWordbank.wordbankId, wordsFilter, true)}
                                disabled={loadingWords}
                                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${dark ? 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}
                              >
                                {loadingWords ? '...' : t('settings.words.loadMore', locale)} ({wordbankWords.length}/{wordsTotal})
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Per-Wordbank Stats */
                  <div className={`rounded-xl border ${dark ? 'bg-[#111] border-neutral-800' : 'bg-white border-neutral-200'}`}>
                    <div className={`p-4 border-b ${dark ? 'border-neutral-800' : 'border-neutral-100'}`}>
                      <h3 className={`font-medium ${dark ? 'text-neutral-200' : 'text-neutral-900'}`}>{t('settings.library.byWordbank', locale)}</h3>
                    </div>
                    <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                      {wordbankStats.map((stat) => (
                        <div
                          key={stat.wordbankId}
                          onClick={() => handleSelectWordbank(stat)}
                          className={`p-4 cursor-pointer transition-colors ${dark ? 'hover:bg-neutral-900' : 'hover:bg-neutral-50'}`}
                        >
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <ProficiencyRing level={Math.min(5, Math.round(stat.masteryRate * 5)) as 0|1|2|3|4|5} size="md" />
                              <div>
                                <h4 className={`font-medium ${dark ? 'text-neutral-200' : 'text-neutral-900'}`}>{stat.wordbankId === '__env__' ? t('settings.manage.envWordbank', locale) : stat.name}</h4>
                                <p className={`text-xs ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>
                                  {stat.encountered} / {stat.total} {t('settings.library.encountered', locale)}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="text-right">
                                <p className={`text-sm font-medium ${dark ? 'text-neutral-300' : 'text-neutral-700'}`}>
                                  {Math.round(stat.masteryRate * 100)}%
                                </p>
                                <p className={`text-xs ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>
                                  {stat.mastered} {t('settings.library.mastered', locale)}
                                </p>
                              </div>
                              <svg className={`w-5 h-5 ${dark ? 'text-neutral-600' : 'text-neutral-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </div>
                          </div>
                          <div className={`h-1 w-full rounded-full overflow-hidden ${dark ? 'bg-neutral-800' : 'bg-neutral-100'}`}>
                            <div className="h-full bg-brand-seal rounded-full transition-all duration-1000 ease-out"
                              style={{ width: `${stat.masteryRate * 100}%` }} />
                          </div>
                        </div>
                      ))}
                      {wordbankStats.length === 0 && (
                        <div className="p-8 text-center">
                          <p className={dark ? 'text-neutral-500' : 'text-neutral-400'}>{t('settings.library.noStats', locale)}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-6">
          {/* Section: API Configuration */}
          <div className={`rounded-lg p-6 space-y-5 ${dark ? 'bg-[#111] border border-neutral-800' : 'bg-white border border-neutral-200'}`}>
            <div>
              <h2 className={`text-lg font-semibold mb-1 ${dark ? 'text-neutral-100' : 'text-neutral-900'}`}>{t('settings.api.title', locale)}</h2>
              <p className={`text-sm ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{t('settings.api.subtitle', locale)}</p>
            </div>

            <div className={`p-3 rounded-lg ${dark ? 'bg-neutral-900' : 'bg-neutral-50'}`}>
              <p className={`text-xs font-medium mb-1 ${dark ? 'text-neutral-400' : 'text-neutral-600'}`}>{t('settings.api.currentInUse', locale)}</p>
              {runtimeStatus?.lastUsedProviderName ? (
                <p className={`text-sm ${dark ? 'text-neutral-200' : 'text-neutral-800'}`}>
                  {runtimeStatus.lastUsedProviderName}
                  {runtimeStatus.lastUsedModel ? ` / ${runtimeStatus.lastUsedModel}` : ''}
                  {runtimeStatus.lastUsedAt ? ` (${new Date(runtimeStatus.lastUsedAt).toLocaleTimeString()})` : ''}
                </p>
              ) : (
                <p className={`text-xs ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{t('settings.api.noRequest', locale)}</p>
              )}
            </div>

            <div className={`p-3 rounded-lg ${dark ? 'bg-neutral-900' : 'bg-neutral-50'}`}>
              <div className="flex items-center justify-between mb-2">
                <p className={`text-xs font-medium ${dark ? 'text-neutral-400' : 'text-neutral-600'}`}>{t('settings.api.endpoints', locale)} ({visibleProviders.length})</p>
                <button
                  type="button"
                  onClick={handleNewProvider}
                  className={`px-2.5 py-1 text-xs rounded-md ${dark ? 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700' : 'bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-100'}`}
                >
                  {t('settings.api.new', locale)}
                </button>
              </div>
              {visibleProviders.length === 0 ? (
                <p className={`text-xs ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{t('settings.api.noEndpoint', locale)}</p>
              ) : (
                <div className="space-y-2">
                  {visibleProviders.map((p, idx) => {
                    const stat = runtimeStatus?.providerStatus?.[p.providerId];
                    return (
                      <div key={p.providerId} className={`p-2 rounded-md border ${dark ? 'border-neutral-800' : 'border-neutral-200'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => handleSelectProvider(p)}
                            className={`text-xs px-2 py-1 rounded-md border ${
                              editingProviderId === p.providerId
                                ? 'border-brand-seal text-brand-seal'
                                : dark ? 'border-neutral-700 text-neutral-300 hover:border-neutral-600' : 'border-neutral-200 text-neutral-700 hover:border-neutral-300'
                            }`}
                          >
                            {(p.name || detectApiType(p.baseUrl || ''))}{p.enabled ? ` ${t('settings.api.active', locale)}` : ` ${t('settings.api.backup', locale)}`}{p.available === false ? ` ${t('settings.api.paused', locale)}` : ''}
                          </button>
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={() => moveProvider(p.providerId, -1)} disabled={idx === 0} className={`px-2 py-1 text-xs rounded ${dark ? 'bg-neutral-800 text-neutral-300 disabled:opacity-40' : 'bg-neutral-100 text-neutral-700 disabled:opacity-40'}`}>{t('settings.api.up', locale)}</button>
                            <button type="button" onClick={() => moveProvider(p.providerId, 1)} disabled={idx === visibleProviders.length - 1} className={`px-2 py-1 text-xs rounded ${dark ? 'bg-neutral-800 text-neutral-300 disabled:opacity-40' : 'bg-neutral-100 text-neutral-700 disabled:opacity-40'}`}>{t('settings.api.down', locale)}</button>
                            <button type="button" onClick={() => toggleProviderAvailable(p, p.available === false)} className={`px-2 py-1 text-xs rounded ${dark ? 'bg-neutral-800 text-neutral-300' : 'bg-neutral-100 text-neutral-700'}`}>{p.available === false ? t('settings.api.enable', locale) : t('settings.api.pause', locale)}</button>
                            <button type="button" onClick={() => deleteProvider(p)} className={`px-2 py-1 text-xs rounded ${dark ? 'bg-red-900/40 text-red-300' : 'bg-red-50 text-red-700'}`}>{t('settings.api.delete', locale)}</button>
                          </div>
                        </div>
                        <p className={`mt-1 text-[11px] ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>
                          {stat?.lastLatencyMs ? `${t('settings.api.latency', locale)} ${stat.lastLatencyMs}ms` : `${t('settings.api.latency', locale)} ${t('settings.api.latencyNa', locale)}`}
                          {stat?.lastError ? ` | ${t('settings.api.lastError', locale)}: ${stat.lastError}` : ''}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-1.5 ${dark ? 'text-neutral-300' : 'text-neutral-700'}`}>{t('settings.api.providerName', locale)}</label>
              <input
                type="text"
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
                className={`w-full px-3 py-2.5 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-seal/20 focus:border-brand-seal ${dark ? 'bg-neutral-900 border border-neutral-700 text-neutral-100' : 'border border-neutral-200 text-neutral-900'}`}
                placeholder={t('settings.api.providerPlaceholder', locale)}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-1.5 ${dark ? 'text-neutral-300' : 'text-neutral-700'}`}>{t('settings.api.baseUrl', locale)}</label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className={`w-full px-3 py-2.5 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-seal/20 focus:border-brand-seal ${dark ? 'bg-neutral-900 border border-neutral-700 text-neutral-100' : 'border border-neutral-200 text-neutral-900'}`}
                placeholder="https://api.openai.com/v1"
              />
              <p className={`mt-1 text-xs ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>{t('settings.api.baseUrlHint', locale)}</p>
            </div>

            <div>
              <label className={`block text-sm font-medium mb-1.5 ${dark ? 'text-neutral-300' : 'text-neutral-700'}`}>{t('settings.api.apiKey', locale)}</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className={`w-full px-3 py-2.5 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-seal/20 focus:border-brand-seal ${dark ? 'bg-neutral-900 border border-neutral-700 text-neutral-100' : 'border border-neutral-200 text-neutral-900'}`}
                placeholder="sk-..."
              />
              <p className={`mt-1 text-xs ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>{t('settings.api.apiKeyHint', locale)}</p>
            </div>

            <div className="relative">
              <label className={`block text-sm font-medium mb-1.5 ${dark ? 'text-neutral-300' : 'text-neutral-700'}`}>{t('settings.api.model', locale)}</label>
              <div className="relative">
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  onFocus={() => models.length > 0 && setShowModelDropdown(true)}
                  onBlur={() => setTimeout(() => setShowModelDropdown(false), 150)}
                  className={`w-full px-3 py-2.5 pr-10 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-seal/20 focus:border-brand-seal ${dark ? 'bg-neutral-900 border border-neutral-700 text-neutral-100' : 'border border-neutral-200 text-neutral-900'}`}
                  placeholder="gpt-3.5-turbo"
                />
                <button
                  type="button"
                  onClick={() => setShowModelDropdown(!showModelDropdown)}
                  className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded transition-colors ${dark ? 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800' : 'text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100'} ${models.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                  disabled={models.length === 0}
                  title={models.length > 0 ? t('settings.api.selectModel', locale) : t('settings.api.noModels', locale)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              </div>
              {showModelDropdown && models.length > 0 && (
                <div className={`absolute z-10 w-full mt-1 max-h-48 overflow-y-auto rounded-lg shadow-float ${dark ? 'bg-neutral-800 border border-neutral-700' : 'bg-white border border-neutral-200'}`}>
                  {models.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setModel(m); setShowModelDropdown(false); }}
                      className={`w-full px-3 py-2 text-left text-sm ${dark ? 'hover:bg-neutral-700' : 'hover:bg-neutral-50'} ${model === m ? 'text-brand-seal font-medium' : dark ? 'text-neutral-300' : 'text-neutral-700'}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
              <p className={`mt-1 text-xs ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>
                {models.length > 0
                  ? t('settings.api.modelHintWithList', locale)
                  : t('settings.api.modelHint', locale)}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                onClick={() => handleSaveApi(true)}
                disabled={saving}
                className="w-full py-2.5 bg-brand-seal text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? t('settings.api.connecting', locale) : t('settings.api.saveAndTest', locale)}
              </button>
              <button
                onClick={() => handleSaveApi(false)}
                disabled={saving}
                className={`w-full py-2.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
                  dark ? 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                }`}
              >
                {t('settings.api.saveBackup', locale)}
              </button>
            </div>
          </div>

          {/* Section: Translation Modes */}
          <div className={`rounded-lg p-6 space-y-5 ${dark ? 'bg-[#111] border border-neutral-800' : 'bg-white border border-neutral-200'}`}>
            <div>
              <h2 className={`text-lg font-semibold mb-1 ${dark ? 'text-neutral-100' : 'text-neutral-900'}`}>{t('settings.modes.title', locale)}</h2>
              <p className={`text-sm ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{t('settings.modes.subtitle', locale)}</p>
            </div>

            {/* Poetry Mode Toggle */}
            <div className={`p-4 rounded-lg ${dark ? 'bg-neutral-900' : 'bg-neutral-50'}`}>
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <span className={`text-sm font-medium ${dark ? 'text-neutral-200' : 'text-neutral-800'}`}>{t('settings.modes.poetry', locale)}</span>
                  <p className={`text-xs mt-0.5 ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{t('settings.modes.poetryDesc', locale)}</p>
                </div>
                <input
                  type="checkbox"
                  checked={poetryEnabled}
                  onChange={(e) => setPoetryEnabled(e.target.checked)}
                  className="w-5 h-5 rounded border-neutral-300 text-brand-seal focus:ring-brand-seal/20"
                />
              </label>
            </div>

            {/* Web Novel Mode Toggle */}
            <div className={`p-4 rounded-lg ${dark ? 'bg-neutral-900' : 'bg-neutral-50'}`}>
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <span className={`text-sm font-medium ${dark ? 'text-neutral-200' : 'text-neutral-800'}`}>{t('settings.modes.webnovel', locale)}</span>
                  <p className={`text-xs mt-0.5 ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{t('settings.modes.webnovelDesc', locale)}</p>
                </div>
                <input
                  type="checkbox"
                  checked={webnovelEnabled}
                  onChange={(e) => setWebnovelEnabled(e.target.checked)}
                  className="w-5 h-5 rounded border-neutral-300 text-brand-seal focus:ring-brand-seal/20"
                />
              </label>
            </div>

            {/* Web Search Toggle */}
            <div className={`p-4 rounded-lg ${dark ? 'bg-neutral-900' : 'bg-neutral-50'}`}>
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <span className={`text-sm font-medium ${dark ? 'text-neutral-200' : 'text-neutral-800'}`}>{t('settings.modes.webSearch', locale)}</span>
                  <p className={`text-xs mt-0.5 ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{t('settings.modes.webSearchDesc', locale)}</p>
                </div>
                <input
                  type="checkbox"
                  checked={webSearchEnabled}
                  onChange={(e) => setWebSearchEnabled(e.target.checked)}
                  className="w-5 h-5 rounded border-neutral-300 text-brand-seal focus:ring-brand-seal/20"
                />
              </label>
            </div>

            {/* Keyboard Shortcuts Info */}
            <div className={`p-4 rounded-lg ${dark ? 'bg-neutral-900' : 'bg-neutral-50'}`}>
              <span className={`text-sm font-medium ${dark ? 'text-neutral-200' : 'text-neutral-800'}`}>{t('settings.modes.shortcuts', locale)}</span>
              <div className={`text-xs mt-2 space-y-1 ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>
                <p>{t('settings.modes.shortcutWordTrans', locale)}</p>
                <p>{t('settings.modes.shortcutParaTrans', locale)}</p>
              </div>
            </div>

            {/* Word Translation Mode */}
            <div className={`p-4 rounded-lg space-y-3 ${dark ? 'bg-neutral-900' : 'bg-neutral-50'}`}>
              <span className={`text-sm font-medium ${dark ? 'text-neutral-200' : 'text-neutral-800'}`}>{t('settings.modes.wordMode', locale)}</span>
              <div className="space-y-2">
                {([0, 1, 2] as const).map(m => (
                  <label key={m} className={`flex items-center gap-3 cursor-pointer p-2 rounded-lg transition-colors ${wordTranslationMode === m ? dark ? 'bg-neutral-800' : 'bg-brand-seal/5' : ''}`}>
                    <input type="radio" name="wordMode" checked={wordTranslationMode === m} onChange={() => setWordTranslationMode(m)}
                      className="w-4 h-4 text-brand-seal focus:ring-brand-seal/20" />
                    <span className={`text-xs ${dark ? 'text-neutral-300' : 'text-neutral-600'}`}>
                      {t(`settings.modes.wordMode.${m === 0 ? 'off' : m === 1 ? 'traced' : 'all'}`, locale)}
                    </span>
                  </label>
                ))}
              </div>
              <div>
                <label className={`block text-xs mb-1 ${dark ? 'text-neutral-400' : 'text-neutral-500'}`}>{t('settings.modes.wordStyle', locale)}</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setWordTranslationStyle('above')}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                      wordTranslationStyle === 'above'
                        ? 'border-brand-seal text-brand-seal bg-brand-seal/5'
                        : dark ? 'border-neutral-700 text-neutral-300 hover:bg-neutral-800' : 'border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                    }`}
                  >
                    {t('settings.modes.wordAbove', locale)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setWordTranslationStyle('left')}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                      wordTranslationStyle === 'left'
                        ? 'border-brand-seal text-brand-seal bg-brand-seal/5'
                        : dark ? 'border-neutral-700 text-neutral-300 hover:bg-neutral-800' : 'border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                    }`}
                  >
                    {t('settings.modes.wordLeft', locale)}
                  </button>
                </div>
              </div>
            </div>

            {/* Paragraph Translation Toggle */}
            <div className={`p-4 rounded-lg ${dark ? 'bg-neutral-900' : 'bg-neutral-50'}`}>
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <span className={`text-sm font-medium ${dark ? 'text-neutral-200' : 'text-neutral-800'}`}>{t('settings.modes.paraToggle', locale)}</span>
                </div>
                <input type="checkbox" checked={paragraphTranslationEnabled} onChange={(e) => setParagraphTranslationEnabled(e.target.checked)}
                  className="w-5 h-5 rounded border-neutral-300 text-brand-seal focus:ring-brand-seal/20" />
              </label>
              <div className="mt-3">
                <label className={`block text-xs mb-1 ${dark ? 'text-neutral-400' : 'text-neutral-500'}`}>{t('settings.modes.paraStyle', locale)}</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setParagraphTranslationStyle('sentence')}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                      paragraphTranslationStyle === 'sentence'
                        ? 'border-brand-seal text-brand-seal bg-brand-seal/5'
                        : dark ? 'border-neutral-700 text-neutral-300 hover:bg-neutral-800' : 'border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                    }`}
                  >
                    {t('settings.modes.paraSentence', locale)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setParagraphTranslationStyle('block')}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                      paragraphTranslationStyle === 'block'
                        ? 'border-brand-seal text-brand-seal bg-brand-seal/5'
                        : dark ? 'border-neutral-700 text-neutral-300 hover:bg-neutral-800' : 'border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                    }`}
                  >
                    {t('settings.modes.paraBlock', locale)}
                  </button>
                </div>
              </div>
            </div>

            {/* Translation Style Customization */}
            <div className={`p-4 rounded-lg space-y-4 ${dark ? 'bg-neutral-900' : 'bg-neutral-50'}`}>
              <span className={`text-sm font-medium ${dark ? 'text-neutral-200' : 'text-neutral-800'}`}>{t('settings.style.title', locale)}</span>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={`block text-xs mb-1 ${dark ? 'text-neutral-400' : 'text-neutral-500'}`}>{t('settings.style.fontSize', locale)}</label>
                  <input type="number" step="0.05" min="0.3" max="2" value={translationFontSizeEm}
                    onChange={e => setTranslationFontSizeEm(parseFloat(e.target.value) || 0.65)}
                    className={`w-full px-3 py-1.5 text-sm rounded-lg ${dark ? 'bg-neutral-800 border border-neutral-700 text-neutral-200' : 'border border-neutral-200'}`} />
                </div>
                <div>
                  <label className={`block text-xs mb-1 ${dark ? 'text-neutral-400' : 'text-neutral-500'}`}>{t('settings.style.underlineStyle', locale)}</label>
                  <select value={translationUnderlineStyle} onChange={e => setTranslationUnderlineStyle(e.target.value)}
                    className={`w-full px-3 py-1.5 text-sm rounded-lg ${dark ? 'bg-neutral-800 border border-neutral-700 text-neutral-200' : 'border border-neutral-200'}`}>
                    {['dotted', 'dashed', 'solid', 'none'].map(s => (
                      <option key={s} value={s}>{t(`settings.style.ul.${s}`, locale)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={`block text-xs mb-1 ${dark ? 'text-neutral-400' : 'text-neutral-500'}`}>{t('settings.style.dotSize', locale)}</label>
                  <input type="number" step="1" min="0" max="12" value={translationDotSizePx}
                    onChange={e => setTranslationDotSizePx(parseInt(e.target.value) || 4)}
                    className={`w-full px-3 py-1.5 text-sm rounded-lg ${dark ? 'bg-neutral-800 border border-neutral-700 text-neutral-200' : 'border border-neutral-200'}`} />
                </div>
                <div>
                  <label className={`block text-xs mb-1 ${dark ? 'text-neutral-400' : 'text-neutral-500'}`}>{t('settings.style.textColor', locale)}</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={translationTextColor} onChange={e => setTranslationTextColor(e.target.value)}
                      className="w-8 h-8 rounded cursor-pointer border-0 p-0" />
                    <input type="text" value={translationTextColor} onChange={e => setTranslationTextColor(e.target.value)}
                      className={`flex-1 px-3 py-1.5 text-sm rounded-lg ${dark ? 'bg-neutral-800 border border-neutral-700 text-neutral-200' : 'border border-neutral-200'}`} />
                  </div>
                </div>
              </div>

              <div className={`rounded-lg border p-3 space-y-3 ${dark ? 'border-neutral-700 bg-neutral-950' : 'border-neutral-200 bg-white'}`}>
                <p className={`text-xs font-medium ${dark ? 'text-neutral-300' : 'text-neutral-700'}`}>{t('settings.modes.preview', locale)}</p>
                <div className={`text-xs ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{t('settings.modes.previewHint', locale)}</div>
                <div className="flex flex-wrap items-end gap-6 pt-1">
                  <div className="space-y-1">
                    <div className={`text-[11px] ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{t('settings.modes.wordPreview', locale)}</div>
                    <div className="inline-block relative pr-2">
                      {wordTranslationStyle === 'above' ? (
                        <ruby className="inline">
                          <span
                            style={{
                              borderBottom: previewUnderlineStyle === 'none'
                                ? 'none'
                                : `2px ${previewUnderlineStyle} rgba(178, 34, 34, 0.45)`,
                            }}
                            className={dark ? 'text-neutral-100' : 'text-neutral-900'}
                          >
                            {previewWord}
                          </span>
                          <rt style={{ fontSize: `${previewFontSize}em`, color: previewTextColor }}>
                            {previewWordMeaning}
                          </rt>
                        </ruby>
                      ) : (
                        <span
                          style={{
                            borderBottom: previewUnderlineStyle === 'none'
                              ? 'none'
                              : `2px ${previewUnderlineStyle} rgba(178, 34, 34, 0.45)`,
                          }}
                          className={dark ? 'text-neutral-100' : 'text-neutral-900'}
                        >
                          <span style={{ fontSize: `${previewFontSize}em`, color: previewTextColor }} className="mr-1">
                            ({previewWordMeaning})
                          </span>
                          {previewWord}
                        </span>
                      )}
                      {previewDotSize > 0 && (
                        <span
                          className="absolute -top-0.5 -right-1 rounded-full"
                          style={{ width: `${previewDotSize}px`, height: `${previewDotSize}px`, backgroundColor: '#F59E0B' }}
                        />
                      )}
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className={`text-[11px] ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{t('settings.modes.paraPreview', locale)}</div>
                  <div className={`rounded-md border p-2 text-xs ${dark ? 'border-neutral-700 bg-neutral-900' : 'border-neutral-200 bg-neutral-50'}`}>
                    <div className={dark ? 'text-neutral-200' : 'text-neutral-800'}>{previewSentenceSource}</div>
                    {paragraphTranslationStyle === 'sentence' ? (
                      <div className="mt-2 space-y-2">
                        <div className={`pt-2 border-t ${dark ? 'border-neutral-700 text-neutral-300' : 'border-neutral-200 text-neutral-600'}`}>{t('settings.modes.previewSen1', locale)}<br />{t('settings.modes.previewTr1', locale)}</div>
                        <div className={`pt-2 border-t ${dark ? 'border-neutral-700 text-neutral-300' : 'border-neutral-200 text-neutral-600'}`}>{t('settings.modes.previewSen2', locale)}<br />{t('settings.modes.previewTr2', locale)}</div>
                      </div>
                    ) : (
                      <div className={`mt-2 p-2 rounded ${dark ? 'bg-brand-seal/10 text-neutral-300' : 'bg-brand-seal/5 text-neutral-600'}`}>
                        {previewSentenceTranslation}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={handleSaveModes}
              disabled={saving}
              className="w-full py-2.5 bg-brand-seal text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? t('settings.api.saving', locale) : t('settings.modes.save', locale)}
            </button>
          </div>
          </div>
        )}

        {activeTab === 'about' && (
          <div className={`rounded-lg p-6 space-y-4 ${dark ? 'bg-[#111] border border-neutral-800' : 'bg-white border border-neutral-200'}`}>
            <div className="text-center py-4">
              <img src="/icons/icon-128.png" alt="Traced" className={`w-20 h-20 mx-auto rounded-2xl mb-4 ${dark ? 'bg-white p-1' : ''}`} />
              <h2 className={`text-xl font-semibold ${dark ? 'text-neutral-100' : 'text-neutral-900'}`}>Traced</h2>
              <p className={`text-sm mt-1 ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{t('settings.about.version', locale)} 0.1.0</p>
            </div>
            <div className={`border-t pt-4 ${dark ? 'border-neutral-800' : 'border-neutral-100'}`}>
              <p className={`text-sm text-center italic ${dark ? 'text-neutral-400' : 'text-neutral-600'}`}>
                "{t('settings.about.slogan', locale)}"
              </p>
              <p className={`text-xs text-center mt-2 ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>
                {t('settings.about.tagline', locale)}
              </p>
            </div>
            <div className={`border-t pt-4 space-y-2 ${dark ? 'border-neutral-800' : 'border-neutral-100'}`}>
              <h3 className={`text-sm font-medium ${dark ? 'text-neutral-300' : 'text-neutral-700'}`}>{t('settings.about.privacy', locale)}</h3>
              <p className={`text-xs ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>
                {t('settings.about.privacyText', locale)}
              </p>
            </div>
          </div>
        )}

        {activeTab === 'dev' && (
          <div className="space-y-6">
            <div className={`rounded-lg p-6 ${dark ? 'bg-[#111] border border-neutral-800' : 'bg-white border border-neutral-200'}`}>
              <div className="flex items-center gap-2 mb-1">
                <h2 className={`text-lg font-semibold ${dark ? 'text-neutral-100' : 'text-neutral-900'}`}>{t('settings.dev.title', locale)}</h2>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">DEV</span>
              </div>
              <p className={`text-sm ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{t('settings.dev.subtitle', locale)}</p>
            </div>

            {devResult && (
              <div className={`p-3 rounded-lg text-sm ${
                devResult.type === 'success'
                  ? dark ? 'bg-green-900/30 text-green-400' : 'bg-green-50 text-green-700'
                  : dark ? 'bg-red-900/30 text-red-400' : 'bg-red-50 text-red-700'
              }`}>{devResult.text}</div>
            )}

            {/* Debug Overlay Toggle */}
            <div className={`rounded-lg border p-4 ${dark ? 'bg-[#111] border-neutral-800' : 'bg-white border-neutral-200'}`}>
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <span className={`text-sm font-medium ${dark ? 'text-neutral-200' : 'text-neutral-800'}`}>{t('settings.dev.debugOverlay', locale)}</span>
                  <p className={`text-xs mt-0.5 ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{t('settings.dev.debugOverlayDesc', locale)}</p>
                </div>
                <input
                  type="checkbox"
                  checked={debugMode}
                  onChange={async (e) => {
                    const val = e.target.checked;
                    setDebugMode(val);
                    await sendMessageFromPopup('UPDATE_SETTINGS', { preferences: { debugMode: val } });
                    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'UPDATE_SETTINGS', settings: { debugMode: val } }).catch(() => {});
                  }}
                  className="w-5 h-5 rounded border-neutral-300 text-brand-seal focus:ring-brand-seal/20"
                />
              </label>
            </div>

            {/* DB Stats */}
            <div className={`rounded-lg border ${dark ? 'bg-[#111] border-neutral-800' : 'bg-white border-neutral-200'}`}>
              <div className={`p-4 border-b flex items-center justify-between ${dark ? 'border-neutral-800' : 'border-neutral-100'}`}>
                <h3 className={`font-medium ${dark ? 'text-neutral-200' : 'text-neutral-900'}`}>{t('settings.dev.dbStats', locale)}</h3>
                <button
                  onClick={() => devAction('getStats', t('settings.dev.refresh', locale))}
                  disabled={devLoading === 'getStats'}
                  className={`text-xs px-3 py-1 rounded-lg transition-colors ${dark ? 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}
                >
                  {devLoading === 'getStats' ? '...' : t('settings.dev.refresh', locale)}
                </button>
              </div>
              {dbStats && (
                <div className="grid grid-cols-3 md:grid-cols-6 gap-px" style={{ background: dark ? '#262626' : '#e5e7eb' }}>
                  {Object.entries(dbStats).map(([key, val]) => (
                    <div key={key} className={`p-3 text-center ${dark ? 'bg-[#111]' : 'bg-white'}`}>
                      <p className={`text-xl font-bold mb-0.5 ${dark ? 'text-neutral-100' : 'text-neutral-900'}`}>{val}</p>
                      <p className={`text-[10px] ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{key}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className={`rounded-lg border ${dark ? 'bg-[#111] border-neutral-800' : 'bg-white border-neutral-200'}`}>
              <div className={`p-4 border-b ${dark ? 'border-neutral-800' : 'border-neutral-100'}`}>
                <h3 className={`font-medium ${dark ? 'text-neutral-200' : 'text-neutral-900'}`}>{t('settings.dev.actions', locale)}</h3>
              </div>
              <div className="p-4 space-y-3">
                {([
                  { action: 'exportData', labelKey: 'settings.dev.exportData', descKey: 'settings.dev.exportDataDesc', color: 'brand-seal' },
                  { action: 'reinitNoiseWords', labelKey: 'settings.dev.reinitNoise', descKey: 'settings.dev.reinitNoiseDesc', color: 'brand-seal' },
                  { action: 'clearEncounters', labelKey: 'settings.dev.clearEncounters', descKey: 'settings.dev.clearEncountersDesc', color: 'amber' },
                  { action: 'clearTraces', labelKey: 'settings.dev.clearTraces', descKey: 'settings.dev.clearTracesDesc', color: 'amber' },
                  { action: 'resetScores', labelKey: 'settings.dev.resetScores', descKey: 'settings.dev.resetScoresDesc', color: 'amber' },
                  { action: 'clearVocabulary', labelKey: 'settings.dev.clearVocab', descKey: 'settings.dev.clearVocabDesc', color: 'red' },
                  { action: 'clearAll', labelKey: 'settings.dev.clearAll', descKey: 'settings.dev.clearAllDesc', color: 'red' },
                  { action: 'resetConfig', labelKey: 'settings.dev.resetConfig', descKey: 'settings.dev.resetConfigDesc', color: 'red' },
                ] as const).map(({ action, labelKey, descKey, color }) => (
                  <div key={action} className={`flex items-center justify-between p-3 rounded-lg ${dark ? 'bg-neutral-900' : 'bg-neutral-50'}`}>
                    <div>
                      <p className={`text-sm font-medium ${dark ? 'text-neutral-200' : 'text-neutral-800'}`}>{t(labelKey, locale)}</p>
                      <p className={`text-xs mt-0.5 ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{t(descKey, locale)}</p>
                    </div>
                    <button
                      onClick={() => devAction(action, t(labelKey, locale))}
                      disabled={!!devLoading}
                      className={`text-sm px-4 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                        color === 'red'
                          ? 'bg-red-500 text-white hover:bg-red-600'
                          : color === 'amber'
                          ? dark ? 'bg-amber-600 text-white hover:bg-amber-500' : 'bg-amber-500 text-white hover:bg-amber-600'
                          : 'bg-brand-seal text-white hover:opacity-90'
                      }`}
                    >
                      {devLoading === action ? '...' : t('settings.dev.execute', locale)}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className={`border-t mt-12 py-6 text-center ${dark ? 'border-neutral-800' : 'border-neutral-200'}`}>
        <p className={`text-xs ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>
          Traced v0.1.0 — {t('settings.about.slogan', locale)}
        </p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Options />);
