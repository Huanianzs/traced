import { useState, useEffect, useRef } from 'react';
import { groupByDate } from '../../lib/date-utils';
import { sendMessage } from '../../lib/messaging';
import { getProficiencyColor } from '../../lib/theme';
import { extractTranslationLine } from '../../lib/translation-utils';
import { t, getLocale } from '../../lib/i18n';
import { getPreloaded } from '../preload';
import { BUILTIN_WORDBANKS } from '../../lib/constants';

interface VocabInfo {
  vocabId: string;
  lemma: string;
  proficiency: number;
  isKnown?: boolean;
  sourceWordbankId?: string;
}

interface CheckVocabResult {
  exists: boolean;
  vocab?: VocabInfo;
  hasEncounterOnPage?: boolean;
  encounterId?: string;
  traceId?: string;
  encounterCount?: number;
  weightedScore?: number;
}

interface Encounter {
  encounterId: string;
  pageUrl: string;
  pageHost: string;
  pageTitle?: string;
  contextSentence?: string;
  source: 'trace' | 'scan' | 'lookup' | 'manual' | 'import' | 'wordbank' | 'rate_known' | 'rate_familiar' | 'rate_unknown';
  createdAt: number;
}

interface InkCardProps {
  word: string;
  contextSentence: string;
  position: { top: number; left: number };
  locator: { textQuote: string; xpath: string; startOffset: number };
  onClose: () => void;
}

interface TranslationResult {
  translatedText: string;
  mode: string;
  model: string;
}

type Mode = 'default' | 'poetry' | 'webnovel';

// Simple in-memory cache
const translationCache = new Map<string, string>();
const getCacheKey = (word: string, mode: Mode) => `${mode}:${word.toLowerCase().trim()}`;


// Group encounters by date
function groupEncountersByDate(encounters: Encounter[]): { date: string; items: Encounter[] }[] {
  return groupByDate(encounters);
}

export function InkCard({ word, contextSentence, position, locator, onClose }: InkCardProps) {
  const locale = getLocale();
  const [mode, setMode] = useState<Mode>('default');
  const [translation, setTranslation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [traced, setTraced] = useState(false);
  const [existingVocab, setExistingVocab] = useState<VocabInfo | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [encounterCount, setEncounterCount] = useState(0);
  const [weightedScore, setWeightedScore] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'trace' | 'lookup'>('all');
  const [ratingInProgress, setRatingInProgress] = useState(false);
  const [hasRated, setHasRated] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const requestSeqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      speechSynthesis.cancel();
    };
  }, []);

  // Reset state and re-translate when word changes
  useEffect(() => {
    // Reset all state
    speechSynthesis.cancel();
    setSpeaking(false);
    setMode('default');
    setTranslation(null);
    setLoading(false);
    setError(null);
    setTraced(false);
    setExistingVocab(null);
    setTraceId(null);
    setEncounterCount(0);
    setWeightedScore(0);
    setShowHistory(false);
    setEncounters([]);
    setLoadingHistory(false);
    setHistoryFilter('all');
    setRatingInProgress(false);
    setHasRated(false);

    // Check if word exists in vocabulary and record lookup if exists
    checkExistingVocabAndRecordLookup();
    // Auto-translate with default mode
    handleTranslate('default');
  }, [word]);

  const checkExistingVocabAndRecordLookup = async () => {
    try {
      const result = await sendMessage<unknown, CheckVocabResult>('CHECK_VOCAB', {
        word,
        pageUrl: window.location.href
      });
      if (mountedRef.current && result.exists && result.vocab) {
        setExistingVocab(result.vocab);
        setEncounterCount(result.encounterCount || 0);
        setWeightedScore(result.weightedScore || 0);
        if (result.hasEncounterOnPage) {
          setTraced(true);
          setTraceId(result.traceId || null);
        }
        // Record lookup for existing vocab words
        await sendMessage('RECORD_ENCOUNTER', {
          vocabId: result.vocab.vocabId,
          word,
          pageUrl: window.location.href,
          pageTitle: document.title,
          faviconUrl: getFaviconUrl(),
          contextSentence,
          locator,
          source: 'lookup'
        });
      }
    } catch {}
  };

  const loadEncounterHistory = async () => {
    if (!existingVocab || loadingHistory) return;
    setLoadingHistory(true);
    try {
      const result = await sendMessage<unknown, { encounters: Encounter[]; total: number }>(
        'GET_WORD_ENCOUNTERS',
        { vocabId: existingVocab.vocabId, limit: 10 }
      );
      // Filter out rate_* encounters (not real page visits)
      const pageEncounters = result.encounters.filter(e => !e.source.startsWith('rate_'));
      setEncounters(pageEncounters);
      setEncounterCount(result.total - (result.encounters.length - pageEncounters.length));
    } catch {}
    setLoadingHistory(false);
  };

  const toggleHistory = () => {
    if (!showHistory && encounters.length === 0) {
      loadEncounterHistory();
    }
    setShowHistory(!showHistory);
  };

  const openEncounterPage = (url: string, context?: string) => {
    const targetUrl = context
      ? `${url}#:~:text=${encodeURIComponent(context.slice(0, 80))}`
      : url;
    window.open(targetUrl, '_blank');
  };

  const handleTranslate = async (selectedMode: Mode) => {
    const seq = ++requestSeqRef.current;
    setMode(selectedMode);
    setError(null);

    // Check cache first
    const cacheKey = getCacheKey(word, selectedMode);
    const cached = translationCache.get(cacheKey);
    if (cached) {
      setTranslation(cached);
      setLoading(false);
      return;
    }

    // Check preload for default mode
    if (selectedMode === 'default') {
      const preloaded = getPreloaded(word);
      if (preloaded?.result) {
        const formatted = formatTranslation(preloaded.result, selectedMode);
        translationCache.set(cacheKey, formatted);
        setTranslation(formatted);
        setLoading(false);
        return;
      }
      if (preloaded?.promise) {
        setLoading(true);
        try {
          const result = await preloaded.promise;
          if (!mountedRef.current) return;
          const formatted = formatTranslation(result, selectedMode);
          translationCache.set(cacheKey, formatted);
          if (seq === requestSeqRef.current) {
            setTranslation(formatted);
            setLoading(false);
          }
          return;
        } catch (err) {
          if (!mountedRef.current) return;
          if (seq === requestSeqRef.current) {
            setError(err instanceof Error ? err.message : 'Translation failed');
            setLoading(false);
          }
          return;
        }
      }
    }

    setLoading(true);
    setTranslation(null);

    // For poetry/webnovel, include the short version from default as context
    let extraContext = '';
    if (selectedMode === 'poetry' || selectedMode === 'webnovel') {
      const defaultCacheKey = getCacheKey(word, 'default');
      const defaultCached = translationCache.get(defaultCacheKey);
      if (defaultCached) {
        const shortVersion = extractTranslationLine(defaultCached, selectedMode);
        if (shortVersion) {
          extraContext = selectedMode === 'poetry'
            ? `\n\n用户看到的诗句是：${shortVersion}`
            : `\n\n用户看到的网文风格是：${shortVersion}`;
        }
      }
    }

    try {
      const result = await sendMessage<unknown, TranslationResult>('TRANSLATE_SELECTION', {
        sourceText: word + extraContext,
        contextSentence,
        mode: selectedMode,
      });
      if (!mountedRef.current) return;

      let formatted = formatTranslation(result.translatedText, selectedMode);

      // For poetry/webnovel, prepend the short version from default
      if (selectedMode === 'poetry' || selectedMode === 'webnovel') {
        const defaultCacheKey = getCacheKey(word, 'default');
        const defaultCached = translationCache.get(defaultCacheKey);
        if (defaultCached) {
          const shortVersion = extractTranslationLine(defaultCached, selectedMode);
          if (shortVersion) {
            formatted = shortVersion + '\n\n---\n\n' + formatted;
          }
        }
      }

      translationCache.set(cacheKey, formatted);

      // Only update UI if this is still the current request
      if (seq === requestSeqRef.current) {
        setTranslation(formatted);
        setLoading(false);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      if (seq === requestSeqRef.current) {
        setError(err instanceof Error ? err.message : 'Translation failed');
        setLoading(false);
      }
    }
  };

  const handleTrace = async () => {
    if (!translation) return;

    try {
      if (traced && traceId) {
        await sendMessage('DELETE_TRACE', { traceId });
        if (existingVocab) {
          document.dispatchEvent(new CustomEvent('traced-word-update', {
            detail: { word, vocabId: existingVocab.vocabId, traced: false }
          }));
        }
        setTraced(false);
        setTraceId(null);
        return;
      }

      // Record new encounter
      const result = await sendMessage<unknown, { encounterId: string; vocabId: string }>('RECORD_ENCOUNTER', {
        vocabId: existingVocab?.vocabId,
        word,
        pageUrl: window.location.href,
        pageTitle: document.title,
        faviconUrl: getFaviconUrl(),
        contextSentence,
        locator,
        source: 'trace'
      });
      setTraced(true);
      if (!existingVocab) {
        setExistingVocab({ vocabId: result.vocabId, lemma: word.toLowerCase(), proficiency: 0 });
      }
      const trace = await sendMessage<unknown, { traceId: string }>('SAVE_TRACE', {
        sourceText: word,
        contextSentence,
        translatedText: translation,
        styleMode: mode,
        pageUrl: window.location.href,
        pageTitle: document.title,
        faviconUrl: getFaviconUrl(),
        locator,
      });
      setTraceId(trace.traceId);
      document.dispatchEvent(new CustomEvent('traced-word-update', {
        detail: { word, vocabId: result.vocabId, traced: true }
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  // Rate word familiarity (green/orange/red dot)
  const handleRate = async (rating: 'known' | 'familiar' | 'unknown') => {
    if (!existingVocab || ratingInProgress || hasRated) return;
    setRatingInProgress(true);
    try {
      const result = await sendMessage<unknown, { newScore: number; isKnown: boolean }>(
        'RATE_WORD',
        { vocabId: existingVocab.vocabId, rating }
      );
      setWeightedScore(result.newScore);
      setExistingVocab({ ...existingVocab, isKnown: result.isKnown });
      setHasRated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rate');
    } finally {
      setRatingInProgress(false);
    }
  };

  const handleSpeak = () => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    u.rate = 0.9;
    u.onstart = () => mountedRef.current && setSpeaking(true);
    u.onend = () => mountedRef.current && setSpeaking(false);
    u.onerror = () => mountedRef.current && setSpeaking(false);
    speechSynthesis.speak(u);
  };

  const style: React.CSSProperties = {
    position: 'absolute',
    top: position.top,
    left: position.left,
    zIndex: 2147483647,
    width: 320,
  };

  return (
    <div style={style} className="animate-scale-in">
      <div className="bg-white border border-neutral-200 shadow-float rounded-lg">
        {/* Header */}
        <div className="p-3 border-b border-neutral-100 rounded-t-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-neutral-900 text-base">{word}</span>
              <svg
                onClick={handleSpeak}
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className={`cursor-pointer transition-colors ${speaking ? 'text-brand-seal' : 'text-neutral-400 hover:text-neutral-600'}`}
              >
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
              {existingVocab && encounterCount > 0 && (
                <button
                  onClick={toggleHistory}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium ${getProficiencyColor(weightedScore)}`}
                >
                  {encounterCount}{t('inkcard.times', locale)}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    className={`transition-transform ${showHistory ? 'rotate-180' : ''}`}>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              )}
              {existingVocab && (() => {
                const wbId = existingVocab.sourceWordbankId;
                if (wbId) {
                  const wb = BUILTIN_WORDBANKS.find(b => b.wordbankId === wbId);
                  return <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{wb?.code?.toUpperCase() || 'Wordbank'}</span>;
                }
                return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">{t('inkcard.discovery', locale)}</span>;
              })()}
            </div>
            <button
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center text-neutral-400 hover:text-neutral-600"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          {contextSentence && (
            <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{contextSentence}</p>
          )}
        </div>

        {/* Encounter History */}
        {showHistory && (
          <div className="border-b border-neutral-100 bg-neutral-50">
            {/* Filter tabs */}
            <div className="flex gap-1 p-2 border-b border-neutral-100">
              {(['all', 'trace', 'lookup'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setHistoryFilter(f)}
                  className={`flex-1 px-3 py-1 text-[10px] rounded transition-colors ${
                    historyFilter === f
                      ? 'bg-brand-seal text-white'
                      : 'bg-neutral-200 text-neutral-600 hover:bg-neutral-300'
                  }`}
                >
                  {f === 'all' ? t('vocab.filter.all', locale) : f === 'trace' ? t('settings.words.traced', locale) : t('settings.words.looked', locale)}
                </button>
              ))}
            </div>
            <div className="max-h-[120px] overflow-y-auto">
              {loadingHistory ? (
                <div className="p-3 text-center text-xs text-neutral-400">{t('inkcard.loading', locale)}</div>
              ) : encounters.filter(e => historyFilter === 'all' || e.source === historyFilter).length === 0 ? (
                <div className="p-3 text-center text-xs text-neutral-400">{t('inkcard.noRecords', locale)}</div>
              ) : (
                <div className="divide-y divide-neutral-100">
                  {groupEncountersByDate(encounters.filter(e => historyFilter === 'all' || e.source === historyFilter)).map(group => (
                    <div key={group.date} className="p-2">
                      <p className="text-[10px] text-neutral-400 mb-1">{group.date}</p>
                      <div className="space-y-1">
                        {group.items.map(e => (
                          <button
                            key={e.encounterId}
                            onClick={() => openEncounterPage(e.pageUrl, e.contextSentence)}
                            className={`w-full flex items-center gap-1.5 text-left hover:bg-white rounded px-4 py-1 transition-colors ${
                              e.source === 'trace' || e.source === 'lookup' ? 'bg-white' : ''
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              e.source === 'trace' ? 'bg-brand-seal' :
                              e.source === 'lookup' ? 'bg-amber-400' : 'bg-neutral-300'
                            }`} />
                            <span className={`text-xs truncate flex-1 ${
                              e.source === 'trace' || e.source === 'lookup' ? 'text-neutral-800 font-medium' : 'text-neutral-500'
                            }`}>{e.pageTitle || e.pageHost}</span>
                            {e.source === 'trace' && <span className="text-[10px] text-brand-seal">{t('settings.words.traced', locale)}</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Mode Tabs */}
        <div className="flex border-b border-neutral-100">
          {(['default', 'poetry', 'webnovel'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => handleTranslate(m)}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                mode === m
                  ? 'text-brand-seal border-b-2 border-brand-seal'
                  : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              {m === 'default' ? t('inkcard.standard', locale) : m === 'poetry' ? t('inkcard.poetry', locale) : t('inkcard.webnovel', locale)}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-3 min-h-[80px]">
          {loading && (
            <div className="flex items-center justify-center py-4">
              <div className="breathing-dots flex gap-1">
                <span className="w-2 h-2 bg-brand-seal rounded-full animate-breathing" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-brand-seal rounded-full animate-breathing" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-brand-seal rounded-full animate-breathing" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
              {error}
            </div>
          )}

          {/* Normal translation display */}
          {!loading && translation && (
            <div className={mode === 'poetry' ? 'font-serif' : ''}>
              {translation.includes('\n\n---\n\n') ? (
                <>
                  <p className="text-sm text-neutral-800 leading-relaxed">{translation.split('\n\n---\n\n')[0]}</p>
                  <hr />
                  {mode === 'webnovel' ? (
                    <div className="text-sm text-neutral-800 leading-relaxed space-y-2">
                      {translation.split('\n\n---\n\n')[1].split('\n\n').map((para, i) => (
                        <p key={i}>{para}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-neutral-800 leading-relaxed whitespace-pre-wrap">
                      {translation.split('\n\n---\n\n')[1]}
                    </p>
                  )}
                </>
              ) : mode === 'webnovel' ? (
                <div className="text-sm text-neutral-800 leading-relaxed space-y-2">
                  {translation.split('\n\n').map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-neutral-800 leading-relaxed whitespace-pre-wrap">
                  {translation}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-neutral-100 rounded-b-lg flex justify-between items-center">
          <div className="flex items-center gap-3">
            {/* Proficiency Group: score + rating dots */}
            {existingVocab && (
              <div className="flex items-center gap-2 bg-neutral-50 rounded-full px-2.5 py-1 border border-neutral-100">
                <span className="text-[10px] font-bold text-neutral-500">
                  {Math.round(weightedScore)}{t('inkcard.points', locale)}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleRate('known')}
                    disabled={ratingInProgress || hasRated}
                    className="group relative w-5 h-5 rounded-full bg-green-500 shadow-sm transition-all hover:scale-110 hover:shadow-md hover:-translate-y-0.5 active:scale-95 disabled:opacity-50"
                  >
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-[10px] text-white bg-neutral-800 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                      {t('inkcard.rateKnown', locale)}
                    </span>
                  </button>
                  <button
                    onClick={() => handleRate('familiar')}
                    disabled={ratingInProgress || hasRated}
                    className="group relative w-5 h-5 rounded-full bg-orange-400 shadow-sm transition-all hover:scale-110 hover:shadow-md hover:-translate-y-0.5 active:scale-95 disabled:opacity-50"
                  >
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-[10px] text-white bg-neutral-800 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                      {t('inkcard.rateFamiliar', locale)}
                    </span>
                  </button>
                  <button
                    onClick={() => handleRate('unknown')}
                    disabled={ratingInProgress || hasRated}
                    className="group relative w-5 h-5 rounded-full bg-red-500 shadow-sm transition-all hover:scale-110 hover:shadow-md hover:-translate-y-0.5 active:scale-95 disabled:opacity-50"
                  >
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-[10px] text-white bg-neutral-800 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                      {t('inkcard.rateUnknown', locale)}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={handleTrace}
            disabled={!translation || loading}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              traced
                ? existingVocab
                  ? 'bg-brand-seal/10 text-brand-seal hover:bg-neutral-100 hover:text-neutral-500'
                  : 'bg-neutral-100 text-neutral-500'
                : 'bg-brand-seal text-white hover:opacity-90 disabled:opacity-50'
            }`}
          >
            {traced ? (existingVocab ? t('inkcard.traced', locale) : '✓ Traced') : 'Trace'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatTranslation(text: string, _mode: Mode): string {
  // Remove any markdown code blocks
  const cleaned = text.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim();

  // Try to parse JSON and extract content
  try {
    const parsed = JSON.parse(cleaned);
    // Handle various JSON formats
    if (parsed.translated_poem) return parsed.translated_poem;
    if (parsed.narrator_voice) return parsed.narrator_voice;
    if (parsed.translation) return parsed.translation;
  } catch {
    // Not JSON, return as-is
  }

  return cleaned;
}

function getFaviconUrl(): string {
  const link = document.querySelector<HTMLLinkElement>('link[rel*="icon"]');
  return link?.href || `${window.location.origin}/favicon.ico`;
}
