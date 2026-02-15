import { useState, useEffect, useRef, useCallback, TouchEvent as RTouch, MouseEvent as RMouse } from 'react';
import { createRoot } from 'react-dom/client';
import { sendMessageFromPopup } from '../lib/messaging';
import { t, getLocale } from '../lib/i18n';
import { isDark, setDark as saveDark, getProficiencyDotColor } from '../lib/theme';
import { ProficiencyRing } from '../components/ProficiencyRing';
import '../styles/index.css';

interface TracedWord {
  vocabId: string;
  lemma: string;
  surface: string;
  weightedScore: number;
  meaning: string;
  sourceTraceId?: string;
  pageHost?: string;
  createdAt: number;
  _translating?: boolean;
}

interface PageVocabItem {
  vocabId: string;
  lemma: string;
  surface: string;
  proficiency: number;
  encounterCount: number;
  weightedScore: number;
  presentCount: number;
  familiarityScore?: number;
  isKnown?: boolean;
  scoreLocked?: boolean;
  pageIndex?: number;
}

interface Settings {
  providers: { apiKey: string; enabled: boolean }[];
  smartHighlightEnabled?: boolean;
  wordTranslationMode?: number;
  paragraphTranslationEnabled?: boolean;
  preferences?: Record<string, unknown>;
}

const SWIPE_THRESHOLD = 60;

// --- VocabSwipeItem: per-card independent swipe state ---
function VocabSwipeItem({ vocab, dark, onTrace, returned }: {
  vocab: PageVocabItem;
  dark: boolean;
  onTrace: (v: PageVocabItem) => void;
  returned?: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [exiting, setExiting] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const axisRef = useRef<'h' | 'v' | null>(null);
  const offsetRef = useRef(0);

  const updateOffset = (v: number) => { offsetRef.current = v; setOffset(v); };

  const end = useCallback(() => {
    if (draggingRef.current && axisRef.current === 'h' && offsetRef.current < -SWIPE_THRESHOLD) {
      setExiting(true);
      setTimeout(() => onTrace(vocab), 250);
    } else {
      updateOffset(0);
    }
    draggingRef.current = false;
    startRef.current = null;
    axisRef.current = null;
  }, [onTrace, vocab]);

  const onMD = (e: RMouse) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startRef.current = { x: e.clientX, y: e.clientY };
    draggingRef.current = true;
    axisRef.current = null;
  };
  const onMM = (e: RMouse) => {
    if (!startRef.current || !draggingRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    if (!axisRef.current) {
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        axisRef.current = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      }
      return;
    }
    if (axisRef.current === 'v') return;
    updateOffset(Math.min(0, dx));
  };
  const onTD = (e: RTouch) => {
    startRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    draggingRef.current = true;
    axisRef.current = null;
  };
  const onTM = (e: RTouch) => {
    if (!startRef.current || !draggingRef.current) return;
    const dx = e.touches[0].clientX - startRef.current.x;
    const dy = e.touches[0].clientY - startRef.current.y;
    if (!axisRef.current) {
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        axisRef.current = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      }
      return;
    }
    if (axisRef.current === 'v') return;
    updateOffset(Math.min(0, dx));
  };

  const opacity = Math.max(0.2, 1 + offset / 300);

  return (
    <div
      style={exiting ? { animation: 'slideOutLeft 0.25s ease-in forwards', pointerEvents: 'none' as const }
        : returned ? { animation: 'slideInTop 0.3s ease-out forwards' }
        : {
        transform: `translateX(${offset}px)`,
        opacity,
        transition: draggingRef.current ? 'none' : 'transform 0.2s ease-out, opacity 0.2s ease-out',
        touchAction: 'pan-y',
      }}
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md select-none ${
        dark ? 'bg-neutral-800/60 hover:bg-neutral-800' : 'bg-neutral-50 hover:bg-neutral-100'
      }`}
      onMouseDown={onMD}
      onMouseMove={onMM}
      onMouseUp={end}
      onMouseLeave={() => { if (draggingRef.current) end(); }}
      onTouchStart={onTD}
      onTouchMove={onTM}
      onTouchEnd={end}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${getProficiencyDotColor(vocab.weightedScore)}`} />
      <span className={`text-sm font-medium truncate ${dark ? 'text-neutral-200' : 'text-neutral-800'}`}>{vocab.surface}</span>
      {vocab.presentCount > 1 && (
        <span className={`text-[10px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>×{vocab.presentCount}</span>
      )}
      <span className="flex-1" />
      {/* Swipe hint arrow — visible during drag */}
      {offset < -10 && !exiting && (
        <span className="text-[10px] text-brand-seal shrink-0">{t('popup.swipeTrace')}</span>
      )}
      <span className={`text-[10px] shrink-0 px-1.5 py-0.5 rounded ${
        dark ? 'bg-neutral-700 text-neutral-400' : 'bg-neutral-200 text-neutral-500'
      }`}>
        {vocab.encounterCount}
      </span>
      {vocab.scoreLocked && (
        <span className={`text-[10px] shrink-0 ${dark ? 'text-amber-500' : 'text-amber-600'}`}>N</span>
      )}
    </div>
  );
}

// --- Main Popup ---
function Popup() {
  const locale = getLocale();
  const [tracedWords, setTracedWords] = useState<TracedWord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [dark, setDark] = useState(isDark);
  const [wordMode, setWordMode] = useState(1);
  const [paraEnabled, setParaEnabled] = useState(false);
  const [pageVocab, setPageVocab] = useState<PageVocabItem[]>([]);
  const [vocabSort, setVocabSort] = useState<'freq' | 'page'>('freq');
  const [pageStats, setPageStats] = useState<{ coverage: number; mastered: number; topMissedWords: Array<{ lemma: string; source: string; presentCount: number; encounterCount: number }> }>({ coverage: 0, mastered: 0, topMissedWords: [] });
  const [vocabExpanded, setVocabExpanded] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [bannerOffsetY, setBannerOffsetY] = useState(0);
  const [bannerExiting, setBannerExiting] = useState(false);
  const [traceAnimKey, setTraceAnimKey] = useState(0);
  const [returnedVocabId, setReturnedVocabId] = useState<string | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const bannerAxisRef = useRef<'h' | 'v' | null>(null);
  const swipeOffsetRef = useRef(0);
  const bannerOffsetYRef = useRef(0);
  const activeTabRef = useRef<number | undefined>(undefined);
  const pageUrlRef = useRef('');
  const pageTitleRef = useRef('');
  const tracingIds = useRef(new Set<string>());
  const swipedFromRef = useRef(new Map<string, PageVocabItem>());
  const cancelledTraceIds = useRef(new Set<string>());

  const allTracedWords = tracedWords;
  const updateSwipeOffset = (v: number) => { swipeOffsetRef.current = v; setSwipeOffset(v); };
  const updateBannerOffsetY = (v: number) => { bannerOffsetYRef.current = v; setBannerOffsetY(v); };

  useEffect(() => { saveDark(dark); }, [dark]);
  useEffect(() => {
    init();
  }, []);

  const init = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabRef.current = tab?.id;
    pageUrlRef.current = tab?.url || '';
    pageTitleRef.current = tab?.title || '';

    try {
      const settings = await sendMessageFromPopup<unknown, Settings>('GET_SETTINGS', {});
      const provider = settings.providers.find(p => p.enabled);
      setHasApiKey(!!provider?.apiKey);
      setWordMode(typeof settings.wordTranslationMode === 'number' ? settings.wordTranslationMode : 1);
      setParaEnabled(settings.paragraphTranslationEnabled === true);
    } catch { setHasApiKey(false); }

    try {
      const result = await sendMessageFromPopup<unknown, { words: TracedWord[] }>('GET_TRACED_WORDS', {});
      setTracedWords(result.words);

      // Auto-translate traced words missing meanings
      const needTranslation = result.words.filter(w => !w.meaning);
      if (needTranslation.length > 0) {
        sendMessageFromPopup<unknown, { translations: Record<string, { meaning: string }> }>('BATCH_TRANSLATE_WORDS', {
          words: needTranslation.map(w => ({ lemma: w.lemma, vocabId: w.vocabId })),
          mode: 'smart',
        }).then(tr => {
          setTracedWords(prev => prev.map(w => {
            const t = tr.translations[w.lemma];
            return t?.meaning && !w.meaning ? { ...w, meaning: t.meaning } : w;
          }));
        }).catch(() => {});
      }
    } catch (err) { console.error('Failed to load traced words:', err); }

    if (tab?.id) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_ALL_PAGE_VOCAB' });
        if (response?.words) setPageVocab(response.words.map((w: PageVocabItem, i: number) => ({ ...w, pageIndex: i })));
      } catch {}
      try {
        const statsResponse = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_STATS' });
        if (statsResponse?.stats) setPageStats(statsResponse.stats);
      } catch {}
    }

    setLoading(false);
  };

  const openOptions = () => chrome.runtime.openOptionsPage();
  const openSidepanel = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/sidepanel/index.html') });
    window.close();
  };

  const cycleWordMode = async () => {
    const next = (wordMode + 1) % 3;
    setWordMode(next);
    try {
      await sendMessageFromPopup('UPDATE_SETTINGS', {
        preferences: { wordTranslationMode: next },
      });
      if (activeTabRef.current) chrome.tabs.sendMessage(activeTabRef.current, { type: 'TOGGLE_TRANSLATION', mode: next });
    } catch {}
  };

  const toggleParagraph = async () => {
    const next = !paraEnabled;
    setParaEnabled(next);
    try {
      await sendMessageFromPopup('UPDATE_SETTINGS', { preferences: { paragraphTranslationEnabled: next } });
      if (activeTabRef.current) chrome.tabs.sendMessage(activeTabRef.current, { type: 'TOGGLE_PARAGRAPH_TRANSLATION', visible: next });
    } catch {}
  };

  const wordModeLabel = wordMode === 0 ? 'OFF' : wordMode === 1 ? t('popup.modeTraced', locale) : t('popup.modeAll', locale);
  const currentTracedWord = allTracedWords[currentIndex];

  // Swipe-to-trace: called when a vocab card is swiped out
  const traceVocab = useCallback((vocab: PageVocabItem) => {
    if (tracingIds.current.has(vocab.vocabId)) return;
    tracingIds.current.add(vocab.vocabId);

    const pageUrl = pageUrlRef.current;
    let pageHost = '';
    try { pageHost = new URL(pageUrl).host; } catch {}

    const tempWord: TracedWord = {
      vocabId: vocab.vocabId,
      lemma: vocab.lemma,
      surface: vocab.surface,
      weightedScore: (vocab.weightedScore || 0) + 1,
      meaning: '',
      pageHost,
      createdAt: Date.now(),
      _translating: true,
    };
    swipedFromRef.current.set(vocab.vocabId, vocab);

    setPageVocab(prev => prev.filter(v => v.vocabId !== vocab.vocabId));
    setTracedWords(prev => [tempWord, ...prev]);
    setCurrentIndex(0);
    setTraceAnimKey(k => k + 1);

    if (activeTabRef.current) {
      chrome.tabs.sendMessage(activeTabRef.current, { type: 'REMOVE_PAGE_VOCAB', vocabId: vocab.vocabId }).catch(() => {});
    }

    sendMessageFromPopup('RECORD_ENCOUNTER', {
      vocabId: vocab.vocabId, word: vocab.surface, pageUrl, pageTitle: pageTitleRef.current, source: 'trace',
    }).catch(() => {});

    sendMessageFromPopup('SAVE_TRACE', {
      sourceText: vocab.surface, translatedText: '', styleMode: 'default', pageUrl, pageTitle: pageTitleRef.current,
    })
      .then((saved: any) => {
        if (!saved?.traceId) return;
        if (cancelledTraceIds.current.has(vocab.vocabId)) {
          cancelledTraceIds.current.delete(vocab.vocabId);
          sendMessageFromPopup('DELETE_TRACE', { traceId: saved.traceId }).catch(() => {});
          return;
        }
        setTracedWords(prev => prev.map(w => w.vocabId === vocab.vocabId
          ? { ...w, meaning: saved.translatedText || '', sourceTraceId: saved.traceId, _translating: !saved.translatedText }
          : w
        ));
      })
      .catch(() => {
        setTracedWords(prev => prev.map(w => w.vocabId === vocab.vocabId ? { ...w, _translating: false } : w));
      })
      .finally(() => { tracingIds.current.delete(vocab.vocabId); });
  }, []);

  const untraceVocab = useCallback(() => {
    const ct = allTracedWords[currentIndex];
    if (!ct) return;

    cancelledTraceIds.current.add(ct.vocabId);

    const original = swipedFromRef.current.get(ct.vocabId);
    if (original) {
      setPageVocab(prev => [original, ...prev]);
      setReturnedVocabId(original.vocabId);
      setTimeout(() => setReturnedVocabId(null), 350);
      swipedFromRef.current.delete(ct.vocabId);
      if (activeTabRef.current) {
        chrome.tabs.sendMessage(activeTabRef.current, { type: 'RESTORE_PAGE_VOCAB', vocab: { ...original, isTraced: false } }).catch(() => {});
      }
    } else {
      if (activeTabRef.current) {
        chrome.tabs.sendMessage(activeTabRef.current, { type: 'TRACED_WORD_UPDATE', word: ct.lemma, traced: false }).catch(() => {});
      }
    }

    setTracedWords(prev => {
      const next = prev.filter(w => w.vocabId !== ct.vocabId);
      setCurrentIndex(idx => Math.min(idx, Math.max(0, next.length - 1)));
      return next;
    });

    // Untrace the word in background
    sendMessageFromPopup('TOGGLE_TRACE_WORD', { vocabId: ct.vocabId, traced: false }).catch(console.error);
    if (ct.sourceTraceId) {
      sendMessageFromPopup('DELETE_TRACE', { traceId: ct.sourceTraceId }).catch(console.error);
    }
  }, [allTracedWords, currentIndex]);

  // Swipe handlers for trace banner (2D axis-locked)
  const handleTouchStart = (e: RTouch) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    isDraggingRef.current = true;
    bannerAxisRef.current = null;
    setBannerExiting(false);
  };
  const handleTouchMove = (e: RTouch) => {
    if (!touchStartRef.current || !isDraggingRef.current) return;
    const dx = e.touches[0].clientX - touchStartRef.current.x;
    const dy = e.touches[0].clientY - touchStartRef.current.y;
    if (!bannerAxisRef.current) {
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        bannerAxisRef.current = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      }
      return;
    }
    if (bannerAxisRef.current === 'h') updateSwipeOffset(dx);
    else if (dy > 0) updateBannerOffsetY(dy);
  };
  const handleSwipeEnd = () => {
    if (isDraggingRef.current) {
      if (bannerAxisRef.current === 'h') {
        if (swipeOffsetRef.current > SWIPE_THRESHOLD && currentIndex > 0) setCurrentIndex(currentIndex - 1);
        else if (swipeOffsetRef.current < -SWIPE_THRESHOLD && currentIndex < allTracedWords.length - 1) setCurrentIndex(currentIndex + 1);
      } else if (bannerAxisRef.current === 'v' && bannerOffsetYRef.current > SWIPE_THRESHOLD) {
        setBannerExiting(true);
        setTimeout(() => { untraceVocab(); setBannerExiting(false); }, 220);
      }
    }
    updateSwipeOffset(0);
    updateBannerOffsetY(0);
    isDraggingRef.current = false;
    touchStartRef.current = null;
    bannerAxisRef.current = null;
  };
  const handleMouseDown = (e: RMouse) => {
    e.preventDefault();
    touchStartRef.current = { x: e.clientX, y: e.clientY };
    isDraggingRef.current = true;
    bannerAxisRef.current = null;
    setBannerExiting(false);
  };
  const handleMouseMove = (e: RMouse) => {
    if (!touchStartRef.current || !isDraggingRef.current) return;
    const dx = e.clientX - touchStartRef.current.x;
    const dy = e.clientY - touchStartRef.current.y;
    if (!bannerAxisRef.current) {
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        bannerAxisRef.current = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      }
      return;
    }
    if (bannerAxisRef.current === 'h') updateSwipeOffset(dx);
    else if (dy > 0) updateBannerOffsetY(dy);
  };

  return (
    <div className={`w-80 h-[420px] flex flex-col ${dark ? 'bg-[#0a0a0a] text-neutral-100' : 'bg-white text-neutral-900'}`}>
      {/* Header */}
      <div className={`px-3 py-2 border-b shrink-0 ${dark ? 'border-neutral-700' : 'border-neutral-200'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/icons/icon-128.png" alt="Traced" className={`w-6 h-6 rounded-lg ${dark ? 'bg-white p-0.5' : ''}`} />
            <span className={`font-semibold text-sm ${dark ? 'text-neutral-100' : 'text-neutral-900'}`}>Traced</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={cycleWordMode}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition-colors ${
                wordMode > 0
                  ? dark ? 'bg-brand-seal/20 text-brand-seal' : 'bg-brand-seal/10 text-brand-seal'
                  : dark ? 'bg-neutral-800 text-neutral-500' : 'bg-neutral-100 text-neutral-400'
              }`}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
              {wordModeLabel}
            </button>
            <button
              onClick={toggleParagraph}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition-colors ${
                paraEnabled
                  ? dark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-500/10 text-blue-600'
                  : dark ? 'bg-neutral-800 text-neutral-500' : 'bg-neutral-100 text-neutral-400'
              }`}
              title="Alt+T"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M3 12h18M3 18h12" />
              </svg>
              {t('popup.para', locale)}
            </button>
            <button onClick={() => setDark(!dark)} className={`p-1 rounded ${dark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100'}`}>
              {dark ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
              )}
            </button>
            <button onClick={openOptions} className={`p-1 rounded ${dark ? 'text-neutral-400 hover:bg-neutral-800' : 'text-neutral-400 hover:bg-neutral-100'}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
            </button>
          </div>
        </div>
      </div>

      {/* API Key Warning */}
      {!hasApiKey && (
        <div className={`mx-3 mt-1.5 p-1.5 rounded-lg text-xs ${dark ? 'bg-amber-900/30 text-amber-400' : 'bg-amber-50 text-amber-700'}`}>
          <button onClick={openOptions} className="underline">{t('popup.configureApiKey', locale)}</button>
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className={`w-5 h-5 border-2 rounded-full animate-spin ${dark ? 'border-neutral-700 border-t-brand-seal' : 'border-neutral-200 border-t-brand-seal'}`} />
        </div>
      ) : (
        <>
          {/* Page Insight Bar */}
          <div className={`mx-3 mt-2 px-3 py-2 rounded-lg shrink-0 flex items-center gap-3 ${dark ? 'bg-neutral-800/60' : 'bg-neutral-50'}`}>
            <ProficiencyRing mode="percent" percent={pageStats.coverage} size="lg">
              {pageStats.mastered ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#d4a017" stroke="#d4a017" strokeWidth="1">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              ) : null}
            </ProficiencyRing>
            <div className="flex-1 min-w-0">
              <div className={`text-xs font-medium ${dark ? 'text-neutral-200' : 'text-neutral-800'}`}>
                {pageStats.mastered ? t('popup.pageMastered', locale) : `${pageStats.coverage}% ${t('popup.coveragePercent', locale)}`}
              </div>
              {pageStats.topMissedWords.length > 0 && !pageStats.mastered && (
                <div className={`text-[10px] mt-0.5 ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                  {pageStats.topMissedWords.length} {t('popup.missedWords', locale)}
                </div>
              )}
            </div>
          </div>

          {/* Top Missed Words */}
          {pageStats.topMissedWords.length > 0 && !pageStats.mastered && (
            <div className="mx-3 mt-1.5 shrink-0">
              <div className="space-y-1">
                {pageStats.topMissedWords.map(w => (
                  <div key={w.lemma} className={`flex items-center gap-2 px-2.5 py-1 rounded text-xs ${dark ? 'bg-neutral-800/40' : 'bg-neutral-50'}`}>
                    <span className={`font-medium ${dark ? 'text-neutral-200' : 'text-neutral-700'}`}>{w.lemma}</span>
                    <span className={`text-[10px] px-1 py-0.5 rounded ${
                      w.source === 'smart-expansion'
                        ? dark ? 'bg-amber-900/30 text-amber-400' : 'bg-amber-50 text-amber-600'
                        : dark ? 'bg-neutral-700 text-neutral-400' : 'bg-neutral-200 text-neutral-500'
                    }`}>
                      {w.source === 'smart-expansion' ? t('popup.discovery', locale) : w.source}
                    </span>
                    <span className="flex-1" />
                    <span className={`text-[10px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                      {w.encounterCount > 0 && `${t('popup.seenCount', locale)} x${w.encounterCount}`}
                      {w.encounterCount > 0 && w.presentCount > 1 && ' · '}
                      {w.presentCount > 1 && `${t('popup.thisPageCount', locale)} x${w.presentCount}`}
                      {!w.encounterCount && w.presentCount <= 1 && `x${w.presentCount}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Compact Trace Banner */}
          <div className="mx-3 mt-2 shrink-0">
            {allTracedWords.length === 0 ? (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${dark ? 'bg-neutral-800 text-neutral-500' : 'bg-neutral-50 text-neutral-400'}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 6v6l4 2" /><circle cx="12" cy="12" r="10" />
                </svg>
                {t('popup.noWords', locale)}
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => currentIndex > 0 && setCurrentIndex(currentIndex - 1)}
                  disabled={currentIndex === 0}
                  className={`shrink-0 p-0.5 rounded ${currentIndex === 0 ? 'opacity-20' : dark ? 'hover:bg-neutral-700' : 'hover:bg-neutral-100'}`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
                </button>

                {/* Trace card — key triggers insert animation */}
                <div
                  key={`${currentTracedWord?.vocabId}-${traceAnimKey}`}
                  className={`flex-1 min-w-0 rounded-lg px-3 py-3 border cursor-grab active:cursor-grabbing select-none ${
                    dark ? 'bg-neutral-800 border-neutral-700' : 'bg-white border-neutral-200'
                  }`}
                  style={{
                    transform: bannerAxisRef.current === 'v' ? `translateY(${bannerOffsetY}px)` : undefined,
                    opacity: bannerAxisRef.current === 'v' ? Math.max(0.3, 1 - bannerOffsetY / 200) : 1,
                    animation: bannerExiting ? 'slideOutDown 0.2s ease-in forwards' : 'slideInRight 0.25s ease-out',
                  }}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleSwipeEnd}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleSwipeEnd}
                  onMouseLeave={() => { if (isDraggingRef.current) handleSwipeEnd(); }}
                >
                  {currentTracedWord && (
                    <div className="flex items-start gap-2"
                      style={{
                        transform: bannerAxisRef.current === 'h' ? `translateX(${swipeOffset}px)` : undefined,
                        transition: isDraggingRef.current ? 'none' : 'transform 0.2s ease-out'
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`font-semibold text-base truncate ${dark ? 'text-neutral-100' : 'text-neutral-900'}`}>
                            {currentTracedWord.surface}
                          </span>
                        </div>
                        {currentTracedWord._translating ? (
                          <div className={`h-4 w-32 mt-1.5 rounded-sm ${dark ? 'bg-neutral-700' : 'bg-neutral-200'}`} style={{ animation: 'breathing 1.2s ease-in-out infinite' }} />
                        ) : currentTracedWord.meaning ? (
                          <p className={`text-sm mt-1 ${dark ? 'text-neutral-400' : 'text-neutral-500'}`}>
                            {currentTracedWord.meaning}
                          </p>
                        ) : null}
                        {bannerOffsetY > 10 && (
                          <p className="text-[10px] mt-1 text-center text-brand-seal">↓ {t('popup.pullBack', locale)}</p>
                        )}
                      </div>
                      {typeof currentTracedWord.weightedScore === 'number' && (
                        <span className={`shrink-0 flex items-center gap-1 text-[10px] px-1 py-0.5 rounded self-center ${dark ? 'bg-neutral-700 text-neutral-400' : 'bg-neutral-100 text-neutral-500'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${getProficiencyDotColor(currentTracedWord.weightedScore)}`} />
                          {Math.round(currentTracedWord.weightedScore * 10) / 10}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => currentIndex < allTracedWords.length - 1 && setCurrentIndex(currentIndex + 1)}
                  disabled={currentIndex >= allTracedWords.length - 1}
                  className={`shrink-0 p-0.5 rounded ${currentIndex >= allTracedWords.length - 1 ? 'opacity-20' : dark ? 'hover:bg-neutral-700' : 'hover:bg-neutral-100'}`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                </button>
              </div>
            )}
            {allTracedWords.length > 0 && (
              <div className="flex items-center justify-center gap-1.5 mt-1">
                {allTracedWords.slice(0, 7).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentIndex(i)}
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${i === currentIndex ? 'bg-brand-seal' : dark ? 'bg-neutral-700' : 'bg-neutral-200'}`}
                  />
                ))}
                {allTracedWords.length > 7 && (
                  <span className={`text-[10px] ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>+{allTracedWords.length - 7}</span>
                )}
              </div>
            )}
          </div>

          {/* Controls Bar */}
          <div className={`mx-3 mt-2 flex items-center justify-between shrink-0 ${dark ? 'text-neutral-400' : 'text-neutral-500'}`}>
            <span className="text-[11px]">
              {t('popup.pageVocab', locale)}: <span className={`font-semibold ${dark ? 'text-neutral-200' : 'text-neutral-700'}`}>{pageVocab.length}</span> {t('popup.vocabInLibrary', locale)}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setVocabSort(vocabSort === 'freq' ? 'page' : 'freq')}
                className={`text-[10px] px-1.5 py-0.5 rounded ${dark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100'}`}
                title={vocabSort === 'freq' ? t('popup.sortByPage', locale) : t('popup.sortByFreq', locale)}
              >
                {vocabSort === 'freq' ? t('popup.sortFreqLabel', locale) : t('popup.sortPageLabel', locale)}
              </button>
              {pageVocab.length > 5 && (
                <button
                  onClick={() => setVocabExpanded(!vocabExpanded)}
                  className={`text-[10px] px-1.5 py-0.5 rounded ${dark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100'}`}
                >
                  {vocabExpanded ? t('popup.showLess', locale) : t('popup.showMore', locale)}
                </button>
              )}
            </div>
          </div>

          {/* Page Vocab List — swipeable cards */}
          <div className="flex-1 mx-3 mt-2 mb-0 overflow-y-auto" style={{ minHeight: 0 }}>
            {pageVocab.length === 0 ? (
              <div className={`flex items-center justify-center h-full text-xs ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>
                {t('popup.noPageVocab', locale)}
              </div>
            ) : (
              <div className="space-y-1">
                {(() => {
                  const sorted = vocabSort === 'freq'
                    ? [...pageVocab].sort((a, b) => b.encounterCount - a.encounterCount)
                    : [...pageVocab].sort((a, b) => (a.pageIndex ?? 0) - (b.pageIndex ?? 0));
                  return (vocabExpanded ? sorted : sorted.slice(0, 5)).map(v => (
                    <VocabSwipeItem
                      key={v.vocabId}
                      vocab={v}
                      dark={dark}
                      onTrace={traceVocab}
                      returned={v.vocabId === returnedVocabId}
                    />
                  ));
                })()}
              </div>
            )}
          </div>
        </>
      )}

      {/* Footer */}
      <div className={`px-3 py-2 border-t shrink-0 flex gap-2 ${dark ? 'border-neutral-700' : 'border-neutral-200'}`}>
        <button
          onClick={openSidepanel}
          className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 ${dark ? 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" />
          </svg>
          {t('popup.allHistory', locale)}
        </button>
        <button
          onClick={openOptions}
          className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 ${dark ? 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" /><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
          {t('popup.settings', locale)}
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Popup />);
