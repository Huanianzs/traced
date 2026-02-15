import { db } from '../../storage/db';
import { AppError } from '../../types/errors';
import { initNoiseWords } from '../../storage/wordbank-loader';
import { DevDebugPayload } from '../../types/protocol';

const DEFAULT_SETTINGS: Record<string, unknown> = {
  wordTranslationMode: 1,
  wordTranslationStyle: 'above',
  smartHighlightEnabled: true,
  smartExpansionEnabled: true,
  defaultHighlightMode: 2,
  promotionMinCount: 6,
  promotionMinPages: 3,
  environmentRankThreshold: 2000,
  cleanupAgeDays: 30,
  cleanupMinCount: 3,
  paragraphTranslationEnabled: false,
  paragraphTranslationStyle: 'block',
  translationFontSizeEm: 0.65,
  translationUnderlineStyle: 'dotted',
  translationDotSizePx: 4,
  translationTextColor: '#666666',
  autoTraceEnabled: true,
  autoTracePoolSize: 30,
  noiseWordbankId: '',
  noiseManualAdd: [],
  noiseManualRemove: [],
  poetryEnabled: true,
  webnovelEnabled: true,
  webSearchEnabled: true,
  debugMode: false,
};

export async function handleDevDebug(payload: unknown): Promise<unknown> {
  const { action } = payload as DevDebugPayload;
  if (!action) throw new AppError('VALIDATION_ERROR', 'action is required', false);

  switch (action) {
    case 'getStats': {
      const [vocab, encounters, traces, wordbanks, wordbankWords, userWordbanks, lemmaStats, settings] = await Promise.all([
        db.vocabulary.count(),
        db.encounters.count(),
        db.traces.count(),
        db.wordbanks.count(),
        db.wordbankWords.count(),
        db.userWordbanks.count(),
        db.lemmaStats.count(),
        db.settings.count(),
      ]);
      return { vocab, encounters, traces, wordbanks, wordbankWords, userWordbanks, lemmaStats, settings };
    }

    case 'clearVocabulary':
      await db.transaction('rw', db.vocabulary, db.encounters, async () => {
        await db.vocabulary.clear();
        await db.encounters.clear();
      });
      await db.settings.delete('noiseWordsInitialized');
      await initNoiseWords();
      return { cleared: ['vocabulary', 'encounters'] };

    case 'clearEncounters':
      await db.encounters.clear();
      return { cleared: ['encounters'] };

    case 'clearTraces':
      await db.traces.clear();
      return { cleared: ['traces'] };

    case 'resetScores':
      await db.vocabulary.filter(v => !v.scoreLocked).modify({
        familiarityScore: 0,
        isKnown: false,
        nextReviewDate: undefined,
        reviewInterval: undefined,
        lastReviewDate: undefined,
      });
      return { reset: true };

    case 'clearAll':
      await db.transaction('rw', db.vocabulary, db.encounters, db.traces, async () => {
        await db.vocabulary.clear();
        await db.encounters.clear();
        await db.traces.clear();
      });
      await db.settings.delete('noiseWordsInitialized');
      await initNoiseWords();
      return { cleared: ['vocabulary', 'encounters', 'traces'] };

    case 'reinitNoiseWords':
      await db.settings.delete('noiseWordsInitialized');
      await initNoiseWords();
      return { reinitialized: true };

    case 'exportData': {
      const [vocabData, encounterData, traceData] = await Promise.all([
        db.vocabulary.toArray(),
        db.encounters.toArray(),
        db.traces.toArray(),
      ]);
      return { vocabulary: vocabData, encounters: encounterData, traces: traceData };
    }

    case 'resetConfig': {
      const now = Date.now();
      // Preserve provider/runtime keys
      const preservePrefixes = ['runtime.'];
      const allSettings = await db.settings.toArray();
      const keysToDelete = allSettings
        .filter(s => !preservePrefixes.some(p => s.key.startsWith(p)))
        .map(s => s.key);
      await db.settings.bulkDelete(keysToDelete);
      // Restore defaults
      const entries = Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value, updatedAt: now }));
      await db.settings.bulkPut(entries);
      // Clear learning state (keep vocabulary structure but reset progress)
      await db.lemmaStats.clear();
      await db.vocabulary.filter(v => !v.scoreLocked).modify({
        familiarityScore: 0,
        isKnown: false,
        isTraced: undefined,
        nextReviewDate: undefined,
        reviewInterval: undefined,
        lastReviewDate: undefined,
      });
      // Reset wordbank selections to defaults
      await db.userWordbanks.clear();
      await initNoiseWords();
      return { reset: true, deletedKeys: keysToDelete.length, restoredKeys: entries.length };
    }

    default:
      throw new AppError('VALIDATION_ERROR', `Unknown action: ${action}`, false);
  }
}
