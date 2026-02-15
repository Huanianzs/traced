import { useState, useEffect, FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { sendMessageFromPopup } from '../lib/messaging';
import { t, getLocale } from '../lib/i18n';
import { formatRelativeDate } from '../lib/date-utils';
import { getProficiencyTextColor } from '../lib/theme';
import '../styles/index.css';

interface Trace {
  traceId: string;
  sourceText: string;
  translatedText: string;
  contextSentence?: string;
  styleMode: 'default' | 'poetry' | 'webnovel';
  pageUrl: string;
  pageTitle?: string;
  faviconUrl?: string;
  createdAt: number;
}

interface PageWord {
  vocabId: string;
  lemma: string;
  surface: string;
  proficiency: 0 | 1 | 2 | 3 | 4 | 5;
  encounterCount: number;
  presentCount: number;
}

type TabType = 'page' | 'history';

function Sidepanel() {
  const locale = getLocale();
  const [tab, setTab] = useState<TabType>('page');
  const [traces, setTraces] = useState<Trace[]>([]);
  const [pageWords, setPageWords] = useState<PageWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadData();
  }, [tab]);

  useEffect(() => {
    // Refresh when sidepanel becomes visible
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') loadData();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [tab]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [tabInfo] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (tab === 'page') {
        await loadPageWords(tabInfo);
      } else {
        await loadHistory();
      }
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadPageWords = async (tabInfo: chrome.tabs.Tab | undefined) => {
    if (!tabInfo?.id || !tabInfo.url || tabInfo.url.startsWith('chrome://')) {
      setPageWords([]);
      return;
    }

    try {
      // Get page text content from content script
      const response = await chrome.tabs.sendMessage(tabInfo.id, { type: 'GET_PAGE_TEXT' }).catch(() => null);
      if (!response?.textContent) {
        setPageWords([]);
        return;
      }

      // Scan for traced words
      const result = await sendMessageFromPopup<unknown, { matches: PageWord[] }>(
        'SCAN_PAGE_WORDS',
        {
          pageUrl: tabInfo.url,
          pageTitle: tabInfo.title,
          textContent: response.textContent,
          record: false
        }
      );

      // Sort by encounter count (rare words first)
      const sorted = result.matches.sort((a, b) => a.encounterCount - b.encounterCount);
      setPageWords(sorted);
    } catch (err) {
      console.error('Failed to scan page:', err);
      setPageWords([]);
    }
  };

  const loadHistory = async (searchTerm?: string) => {
    try {
      const result = await sendMessageFromPopup<unknown, { traces: Trace[]; total: number }>(
        'GET_TRACES',
        { limit: 100, search: searchTerm }
      );
      setTraces(result.traces);
    } catch (err) {
      console.error('Failed to load traces:', err);
    }
  };

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    if (tab === 'history') loadHistory(search);
  };

  const openPage = (url: string, textQuote?: string) => {
    // Use Text Fragment API for highlighting
    const targetUrl = textQuote
      ? `${url}#:~:text=${encodeURIComponent(textQuote)}`
      : url;
    chrome.tabs.create({ url: targetUrl });
  };

  const formatDate = (timestamp: number) => formatRelativeDate(timestamp, t, locale);

  const getModeLabel = (mode: string) => t(`mode.${mode}`, locale);

  const getFrequencyOpacity = (count: number) => {
    if (count <= 2) return 'opacity-30';
    if (count <= 5) return 'opacity-60';
    return 'opacity-100';
  };

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-neutral-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <img src="/icons/icon-128.png" alt="Traced" className="w-8 h-8 rounded-lg" />
          <h1 className="font-semibold text-neutral-900">{t('sidepanel.title', locale)}</h1>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-neutral-100 rounded-lg mb-3">
          <button
            onClick={() => setTab('page')}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === 'page' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
            }`}
          >
            📍 {t('sidepanel.tabPage', locale)}
          </button>
          <button
            onClick={() => setTab('history')}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === 'history' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
            }`}
          >
            🕐 {t('sidepanel.tabHistory', locale)}
          </button>
        </div>

        {tab === 'history' && (
          <form onSubmit={handleSearch}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('sidepanel.search', locale)}
              className="w-full px-3 py-2 text-sm bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-seal/20 focus:border-brand-seal"
            />
          </form>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-neutral-200 border-t-brand-seal rounded-full animate-spin" />
          </div>
        ) : tab === 'page' ? (
          /* Page Words Tab */
          pageWords.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-neutral-500">{t('sidepanel.noPageWords', locale)}</p>
              <p className="text-sm text-neutral-400 mt-1">{t('sidepanel.noPageWordsHint', locale)}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-neutral-400 mb-3">
                {pageWords.length} {t('sidepanel.wordsOnPage', locale)}
              </p>
              {pageWords.map((word) => (
                <div
                  key={word.vocabId}
                  className="bg-white border border-neutral-200 rounded-lg p-3 hover:shadow-card transition-shadow"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${getProficiencyTextColor(word.proficiency)} ${getFrequencyOpacity(word.encounterCount)}`} />
                      <span className="font-semibold text-neutral-900">{word.surface}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-neutral-400">
                      <span>{word.presentCount}x {t('sidepanel.onPage', locale)}</span>
                      <span>·</span>
                      <span>{word.encounterCount} {t('sidepanel.encounters', locale)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          /* History Tab */
          traces.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-neutral-500">{t('sidepanel.noWords', locale)}</p>
              <p className="text-sm text-neutral-400 mt-1">{t('sidepanel.startHint', locale)}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {traces.map((trace) => (
                <div
                  key={trace.traceId}
                  className="bg-white border border-neutral-200 rounded-lg p-3 hover:shadow-card transition-shadow"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-neutral-900">{trace.sourceText}</span>
                        <span className="text-xs px-1.5 py-0.5 bg-neutral-100 text-neutral-600 rounded">
                          {getModeLabel(trace.styleMode)}
                        </span>
                      </div>
                      <p className="text-sm text-neutral-600 mt-1 line-clamp-2">
                        {trace.translatedText}
                      </p>
                      {trace.contextSentence && (
                        <p className="text-xs text-neutral-400 mt-2 line-clamp-1 italic">
                          "{trace.contextSentence}"
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-neutral-100">
                    <div className="flex items-center gap-2 text-xs text-neutral-500">
                      {trace.faviconUrl && (
                        <img src={trace.faviconUrl} alt="" className="w-4 h-4" onError={(e) => e.currentTarget.style.display = 'none'} />
                      )}
                      <span className="truncate max-w-[150px]">{trace.pageTitle || new URL(trace.pageUrl).host}</span>
                      <span>·</span>
                      <span>{formatDate(trace.createdAt)}</span>
                    </div>
                    <button
                      onClick={() => openPage(trace.pageUrl, trace.contextSentence)}
                      className="text-xs text-brand-seal hover:underline"
                    >
                      {t('sidepanel.openPage', locale)}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Sidepanel />);
